import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import type { DevToolsKey, DevToolsLocale, TVars } from '../../i18n/types';
import { useDevToolsT } from '../../i18n/use-devtools-t';
import { canReadText, readText } from '../../panel/copy-text';
import { Button } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { useSheetKit } from '../../ui/sheet-kit';
import { Text } from '../../ui/Text';
import type { DevToolsTheme } from '../../ui/theme';
import { useStyles, useTheme } from '../../ui/use-styles';
import {
  isConnectionListCorrupt,
  isConnectionStoreReadError,
  maskSecret,
  type ConnectionStore,
  type StoredConnection,
} from '../connections/connection-store';
import { makeConnectorContext } from '../connectors/http';
import {
  ConnectorError,
  type ConnectorField,
  type ConnectorOption,
  type ConnectorType,
  type ConnectorValues,
} from '../connectors/types';
import {
  ConnectionField,
  connectionFieldStylesOf,
  type ConnectionFieldValue,
} from './ConnectionField';
import {
  READ_FAILURES_BEFORE_RESET,
  ResetConnectionsNotice,
  type ResetReason,
} from './ResetConnectionsNotice';

type Values = Readonly<Record<string, ConnectionFieldValue>>;
type Secrets = Readonly<Record<string, string>>;
type Options = Readonly<Record<string, readonly ConnectorOption[]>>;
type T = (key: DevToolsKey, vars?: TVars) => string;

/** Kết quả **Thử kết nối** còn hiệu lực với thông tin hiện tại. */
interface Tested {
  readonly resolved: Values;
  readonly account?: string;
}

/** Các trường thêm của đích (Jira: trường bắt buộc của project + loại issue). */
interface Extras {
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly fields: readonly ConnectorField[];
}

/** Câu báo lỗi đã ánh xạ: `field` ⇒ hiện ngay dưới ô đó; `detail` ⇒ dòng phụ (đã che bí mật). */
interface Feedback {
  readonly message: string;
  readonly detail?: string;
  readonly field?: string;
}

const IDLE: Extras = { status: 'idle', fields: [] };
const NO_IDS: ReadonlySet<string> = new Set();
const LOCALES: readonly DevToolsLocale[] = ['vi', 'en'];
/** Bí mật ngắn hơn mức này không bị che trong câu lỗi — che chuỗi 1-3 ký tự là phá nát câu. */
const MIN_SCRUB = 4;

const stylesOf = (t: DevToolsTheme) => ({
  root: { backgroundColor: t.colors.background.surface },
  body: { gap: t.spacing.md, paddingVertical: t.spacing.md },
  pad: { paddingHorizontal: t.spacing.md, gap: t.spacing['2xs'] },
  chips: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: t.spacing.xs },
  actions: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: t.spacing.xs },
  warning: {
    gap: t.spacing.xs,
    padding: t.spacing.sm,
    borderRadius: t.radius.md,
    borderWidth: t.borderWidth.thin,
    borderColor: t.colors.border.strong,
    backgroundColor: t.colors.background.surfaceAlt,
  },
});

const isFieldValue = (v: unknown): v is ConnectionFieldValue =>
  typeof v === 'string' ||
  typeof v === 'boolean' ||
  (Array.isArray(v) && v.every((x) => typeof x === 'string'));

/** Chỉ giữ giá trị đúng dạng ô (chuỗi · boolean · mảng chuỗi). */
const cleanValues = (input: ConnectorValues | undefined): Values => {
  const out: Record<string, ConnectionFieldValue> = {};
  for (const [k, v] of Object.entries(input ?? {})) if (isFieldValue(v)) out[k] = v;
  return out;
};

const hasValue = (v: ConnectionFieldValue | undefined): boolean => {
  if (typeof v === 'boolean') return true;
  if (Array.isArray(v)) return v.length > 0;
  return typeof v === 'string' && v.trim() !== '';
};

const isVisible = (f: ConnectorField, values: Values): boolean => {
  const when = f.visibleWhen;
  if (when === undefined) return true;
  const current = values[when.field] ?? (typeof when.equals === 'boolean' ? false : undefined);
  return current === when.equals;
};

const isChoice = (f: ConnectorField): boolean => f.kind === 'select' || f.kind === 'multiselect';

/** Ô chọn mà lựa chọn đến từ đích (Thử kết nối / `loadOptions`) — đổi nó không làm cũ kết quả thử. */
const isDynamic = (f: ConnectorField): boolean =>
  isChoice(f) && (f.options === undefined || f.dependsOn !== undefined);

const omit = <V,>(record: Readonly<Record<string, V>>, ids: readonly string[]) => {
  if (ids.length === 0) return record;
  const out = { ...record };
  for (const id of ids) delete out[id];
  return out;
};

/** Thay mọi bí mật (dài ≥ 4) trong `text` bằng `••••`. */
const scrub = (text: string, secrets: readonly string[]): string =>
  secrets
    .filter((s) => s.length >= MIN_SCRUB)
    .sort((a, b) => b.length - a.length)
    .reduce((acc, s) => acc.split(s).join('••••'), text);

/** Mã kết nối mới: `conn-<base36 thời gian>-<6 ký tự ngẫu nhiên>`. */
const newConnectionId = (): string =>
  `conn-${Date.now().toString(36)}-${Math.floor(Math.random() * 36 ** 6)
    .toString(36)
    .padStart(6, '0')}`;

/**
 * Ánh xạ lỗi của connector sang câu báo (spec 5.4: nhóm lỗi cố định). Câu của chính connector
 * (`validation`, `permission` của loại khác Jira, chi tiết `unknown`) được che mọi bí mật đang có
 * trên form trước khi lên màn. Lỗi không phải `ConnectorError` ⇒ câu chung, không lộ thông điệp gốc.
 */
const describeError = (
  error: unknown,
  typeId: string,
  t: T,
  secrets: readonly string[],
): Feedback => {
  if (!(error instanceof ConnectorError)) return { message: t('connections.editor.errUnknown') };
  const own = scrub(error.message, secrets).trim();
  switch (error.kind) {
    case 'auth':
      return { message: t('connections.editor.errAuth') };
    case 'permission':
      return {
        message:
          typeId === 'jira-cloud'
            ? t('connections.editor.errJiraPermission')
            : own || t('connections.editor.errPermission'),
      };
    case 'validation':
      return { message: own || t('connections.editor.errUnknown'), field: error.field };
    case 'network':
      return { message: t('connections.editor.errNetwork') };
    case 'uncertain':
      return { message: t('connections.editor.errUncertain') };
    case 'rate-limit':
      return { message: t('connections.editor.errRateLimit') };
    default:
      return { message: t('connections.editor.errUnknown'), detail: own || undefined };
  }
};

export interface ConnectionEditorProps {
  /** Loại kết nối — form dựng từ `type.fields(uiLocale)`. */
  type: ConnectorType;
  connections: ConnectionStore;
  /** Có ⇒ sửa kết nối này (giữ `id`, `createdAt`; bí mật đã lưu chỉ hiện dạng che). */
  initial?: StoredConnection;
  /**
   * Ngôn ngữ giao diện: nhãn các ô, ctx của `test`/`loadOptions`/`loadExtraFields` (R38), và mặc định
   * của "Ngôn ngữ ticket" khi tạo mới.
   */
  uiLocale: DevToolsLocale;
  /** Đã lưu vào kho. */
  onSaved: (connection: StoredConnection) => void;
  onCancel: () => void;
}

/**
 * **Chức năng:** form thêm/sửa một kết nối, **dựng từ schema** của loại kết nối (spec 5.4) — thân của
 * một trang trong sheet báo bug (sheet chứa đặt tiêu đề `connections.editor.titleNew`/`titleEdit`).
 * Gốc là `SheetKit.ScrollView` ⇒ sheet chứa dùng `contentMode="scrollable"`.
 *
 * - **Ô:** "Tên kết nối" · các ô của `type.fields(uiLocale)` theo `visibleWhen` · trường thêm do
 *   `loadExtraFields` trả · "Ngôn ngữ ticket" vi/en (mặc định `uiLocale`, spec 11.2). Ô bí mật bị
 *   che, có nút **Dán** khi máy đọc được bộ nhớ tạm (R9); khi sửa, bí mật đã lưu chỉ hiện `••••xxxx`
 *   và để trống là giữ nguyên.
 * - **Thử kết nối:** `type.test(values, secrets, makeConnectorContext(uiLocale))` ⇒ lựa chọn
 *   cho ô chọn (giá trị cũ không còn trong danh sách bị bỏ chọn). `test`/`loadOptions`/
 *   `loadExtraFields` đều nhận ctx theo **ngôn ngữ giao diện** — câu báo của đích ở form này là cho
 *   QA đọc; ngôn ngữ ticket chỉ dùng khi gửi (R38). `resolved` (vd `baseUrl`,
 *   `cloudId`) được giữ và **lưu vào `values`** (R22). Rồi, theo thứ tự ô: ô `dependsOn` có ô cha đã
 *   chọn ⇒ `loadOptions`; mọi ô bắt buộc đã đủ ⇒ `loadExtraFields`. Đổi ô chọn lấy từ đích (project)
 *   ⇒ bỏ chọn ô con, nạp lại như trên. Đổi ô khác (chữ, bí mật, ô chọn cố định) ⇒ kết quả thử hết hiệu
 *   lực, phải thử lại.
 * - **Lưu** khoá cho tới khi: thử thành công với thông tin hiện tại · đủ ô bắt buộc · không có trường
 *   `unsupportedType` (chỉ hiện câu `help`, R22) · trường thêm đã nạp. Có dòng nêu lý do khoá.
 *   `longLivedSecret(values)` ⇒ cảnh báo 5.4.2 hiện **một lần** trước khi lưu (không hiện khi sửa một
 *   kết nối vốn đã sống lâu). Lưu: `connections.save(kết nối, bí mật)` — bí mật **chỉ** đi qua tham
 *   số thứ hai, không bao giờ vào `values`, log hay câu lỗi; xong thì ô bí mật trống lại, chỉ còn
 *   dạng che. Một lần lưu đang chạy chặn mọi lần lưu khác (bấm đúp, "Đã hiểu, lưu" hai lần). Kho báo
 *   danh sách hỏng ⇒ khối "Đặt lại kết nối" (R18); kho ném khi đọc ở hai lần lưu liền nhau ⇒ cũng khối
 *   đó, kèm cảnh báo mất mọi kết nối và bí mật (R39) — lần đầu chỉ báo "Không lưu được…", lưu thành
 *   công hoặc lỗi khác thì đếm lại.
 * - Sửa ô giữa lúc đang thử ⇒ lượt thử đó bị bỏ, nút Thử thôi bận ngay; kết quả của lượt cũ về sau
 *   không đụng lượt mới. Cờ "còn gắn" đặt lại `true` trong effect (an toàn với StrictMode).
 * - **Lỗi:** `auth` ⇒ "Sai email hoặc token…"; `permission` của Jira ⇒ câu Atlassian Guard;
 *   `validation` có `field` ⇒ ngay dưới ô đó; `network` ⇒ câu mất mạng; còn lại ⇒ câu chung.
 *
 * Trạng thái đầu lấy từ `type`/`initial` lúc gắn: chỗ chứa đổi loại hay kết nối thì đặt `key` mới.
 *
 * **Input:** {@link ConnectionEditorProps}. **Output:** thân trang form.
 *
 * @example
 * ```tsx
 * <ConnectionEditor type={jiraCloudConnector} connections={store} uiLocale="vi"
 *   onSaved={(c) => backToList(c)} onCancel={backToList} />
 * // Ca biên: Jira có trường bắt buộc kiểu Sprint ⇒ câu "Trường Sprint (kiểu gh-sprint) chưa hỗ
 * // trợ…", nút Lưu khoá.
 * ```
 *
 * **Unit test:** `ConnectionEditor.test.tsx` — 36 case × 2 kit (gorhom, plain): schema Jira thật ·
 * ngôn ngữ ticket mặc định · visibleWhen (Slack thật) · Dán · không Dán khi thiếu bộ nhớ tạm · thử ⇒
 * lựa chọn + ctx theo ngôn ngữ giao diện · R38: test/loadOptions/loadExtraFields theo ngôn ngữ giao
 * diện dù ngôn ngữ ticket khác · ô cha ⇒ loadOptions · loadExtraFields + trường chưa hỗ trợ
 * khoá Lưu · Lưu khoá trước khi thử / sau khi sửa · thiếu ô bắt buộc · lưu resolved, bí mật tách
 * riêng, không console · tên + ngôn ngữ + Huỷ · sau khi lưu chỉ còn dạng che · sửa kết nối đã lưu ·
 * cảnh báo sống lâu một lần · không cảnh báo khi đã sống lâu · lưu ném danh sách hỏng ⇒ đặt lại ·
 * lưu lỗi khác · đọc kho hỏng một lần / hai lần liền (đếm lại sau thành công) · bấm Lưu đúp · bấm
 * "Đã hiểu, lưu" đúp · sửa ô giữa lúc thử ⇒ thử lại ngay · StrictMode: Dán, Thử, Lưu · StrictMode:
 * lưu hỏng không kẹt · 6 nhóm lỗi (auth, permission Jira, network, uncertain, rate-limit, lỗi lạ) ·
 * permission loại khác · validation dưới ô · unknown che bí mật · màu sáng/tối (2).
 */
export const ConnectionEditor = ({
  type,
  connections,
  initial,
  uiLocale,
  onSaved,
  onCancel,
}: ConnectionEditorProps) => {
  const { ScrollView, TextInput } = useSheetKit();
  const styles = useStyles(stylesOf);
  const fieldStyles = useStyles(connectionFieldStylesOf);
  const theme = useTheme();
  const t = useDevToolsT();

  const baseFields = useMemo(() => type.fields(uiLocale), [type, uiLocale]);
  const isSecret = useCallback(
    (f: ConnectorField) => f.kind === 'secret' || type.secretFieldIds.includes(f.id),
    [type],
  );
  // Chỉ chạm `Clipboard` (getter có cảnh báo deprecated) khi form thật sự có ô bí mật.
  const canPaste = useMemo(
    () => baseFields.some(isSecret) && canReadText(),
    [baseFields, isSecret],
  );

  const [id] = useState(() => initial?.id ?? newConnectionId());
  const [createdAt] = useState(() => initial?.createdAt ?? Date.now());
  const [name, setName] = useState(() => initial?.name ?? type.label(uiLocale));
  const [ticketLocale, setTicketLocale] = useState<DevToolsLocale>(
    () => initial?.ticketLocale ?? uiLocale,
  );
  const [values, setValues] = useState<Values>(() => cleanValues(initial?.values));
  const [drafts, setDrafts] = useState<Secrets>({});
  const [saved, setSaved] = useState<Secrets>({});
  const [secretsReady, setSecretsReady] = useState(initial === undefined);
  const [tested, setTested] = useState<Tested | null>(null);
  const [options, setOptions] = useState<Options>({});
  const [loadingIds, setLoadingIds] = useState<ReadonlySet<string>>(NO_IDS);
  const [extras, setExtras] = useState<Extras>(IDLE);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [saveError, setSaveError] = useState<'failed' | ResetReason | null>(null);
  const [warning, setWarning] = useState(false);

  /** QA đã đồng ý cảnh báo 5.4.2 trong lượt sửa này. */
  const warned = useRef(false);
  /** Thế hệ của kết quả bất đồng bộ: mọi thay đổi làm cũ kết quả đang chờ thì tăng nó. */
  const gen = useRef(0);
  /** Một lần lưu đang chạy — chặn bấm đúp / "Đã hiểu, lưu" gọi `save`/`onSaved` hai lần. */
  const savingNow = useRef(false);
  /** Số lần lưu liền nhau hỏng vì kho ném khi đọc (R39). */
  const readFailures = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    // Đặt lại trong effect: StrictMode chạy gắn → dọn → gắn lại trên cùng một ref.
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const initialId = initial?.id;
  useEffect(() => {
    if (initialId === undefined) return;
    let cancelled = false;
    const done = (secrets: ConnectorValues | null) => {
      if (cancelled) return;
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(secrets ?? {})) {
        if (typeof v === 'string' && v !== '') out[k] = v;
      }
      setSaved(out);
      setSecretsReady(true);
    };
    connections.secrets(initialId).then(done, () => done(null));
    return () => {
      cancelled = true;
    };
  }, [connections, initialId]);

  /** Giá trị không bí mật của các ô đang hiện (bỏ ô bí mật, ô chưa hỗ trợ, ô trống). */
  const valuesOf = useCallback(
    (vals: Values, fields: readonly ConnectorField[]): Values => {
      const out: Record<string, ConnectionFieldValue> = {};
      for (const f of fields) {
        if (isSecret(f) || f.unsupportedType !== undefined || !isVisible(f, vals)) continue;
        const v = vals[f.id];
        if (v !== undefined && hasValue(v)) out[f.id] = v;
      }
      return out;
    },
    [isSecret],
  );

  /** Bí mật của các ô bí mật đang hiện: chữ đang gõ, không thì bản đã lưu. */
  const secretsOf = useCallback(
    (vals: Values): Secrets => {
      const out: Record<string, string> = {};
      for (const f of baseFields) {
        if (!isSecret(f) || !isVisible(f, vals)) continue;
        const typed = drafts[f.id];
        const kept = saved[f.id];
        if (typed !== undefined && typed.trim() !== '') out[f.id] = typed;
        else if (kept !== undefined) out[f.id] = kept;
      }
      return out;
    },
    [baseFields, drafts, isSecret, saved],
  );

  const filled = useCallback(
    (f: ConnectorField, vals: Values): boolean => {
      if (!isSecret(f)) return hasValue(vals[f.id]);
      return (drafts[f.id] ?? '').trim() !== '' || saved[f.id] !== undefined;
    },
    [drafts, isSecret, saved],
  );

  const requiredFilled = useCallback(
    (fields: readonly ConnectorField[], vals: Values): boolean =>
      fields.every(
        (f) =>
          !f.required || f.unsupportedType !== undefined || !isVisible(f, vals) || filled(f, vals),
      ),
    [filled],
  );

  /** Mọi bí mật đang có trên form — để che khỏi câu lỗi. */
  const knownSecrets = useCallback(
    (): string[] => [...Object.values(drafts), ...Object.values(saved)],
    [drafts, saved],
  );

  /** Các ô `dependsOn` (trực tiếp hoặc gián tiếp) của `id`. */
  const descendantsOf = useCallback(
    (id: string): string[] => {
      const out: string[] = [];
      const walk = (parent: string) => {
        for (const f of baseFields) {
          if (f.dependsOn === parent && !out.includes(f.id)) {
            out.push(f.id);
            walk(f.id);
          }
        }
      };
      walk(id);
      return out;
    },
    [baseFields],
  );

  /**
   * Kết quả thử hết hiệu lực: mọi thứ lấy từ đích bị bỏ, kết quả đang chờ thành cũ — kể cả lượt thử
   * đang chạy, nên nút Thử thôi bận ngay (QA sửa token giữa lúc thử là thử lại được liền).
   */
  const invalidate = useCallback(() => {
    gen.current += 1;
    setTesting(false);
    setTested(null);
    setOptions({});
    setLoadingIds(NO_IDS);
    setExtras(IDLE);
    setFeedback(null);
    setSaveError(null);
    setWarning(false);
  }, []);

  /**
   * Sau khi thử / đổi ô chọn lấy từ đích: nạp lựa chọn của ô con có ô cha đã chọn (theo thứ tự ô, giá
   * trị không còn trong danh sách bị bỏ chọn), rồi — khi mọi ô bắt buộc đã đủ — nạp trường thêm.
   */
  const refresh = useCallback(
    async (vals0: Values, resolved: Values, opts0: Options, myGen: number) => {
      const stale = () => !alive.current || gen.current !== myGen;
      // R38: câu báo của đích ở form này là cho QA đọc ⇒ ngôn ngữ giao diện, không phải của ticket.
      const ctx = makeConnectorContext(uiLocale);
      const secrets = secretsOf(vals0);
      let vals = vals0;
      const opts: Record<string, readonly ConnectorOption[]> = { ...opts0 };
      const cleared: string[] = [];
      const loadOptions = type.loadOptions;
      const pending =
        loadOptions === undefined
          ? []
          : baseFields.filter(
              (f) =>
                f.dependsOn !== undefined &&
                opts[f.id] === undefined &&
                isVisible(f, vals) &&
                hasValue(vals[f.dependsOn]),
            );
      /** Ghi những gì đã nạp được (kể cả khi dừng giữa chừng vì lỗi). */
      const commit = () => {
        setLoadingIds(NO_IDS);
        if (pending.length === 0) return;
        setOptions({ ...opts });
        setValues((prev) => omit(prev, cleared));
      };

      if (pending.length > 0) setLoadingIds(new Set(pending.map((f) => f.id)));
      try {
        for (const f of pending) {
          if (loadOptions === undefined || !hasValue(vals[f.dependsOn as string])) continue;
          const list = await loadOptions(
            f.id,
            { ...valuesOf(vals, baseFields), ...resolved },
            secrets,
            ctx,
          );
          if (stale()) return;
          opts[f.id] = list;
          const v = vals[f.id];
          if (typeof v === 'string' && !list.some((o) => o.id === v)) {
            const gone = [f.id, ...descendantsOf(f.id)];
            cleared.push(...gone);
            vals = omit(vals, gone);
          }
        }
      } catch (error) {
        if (stale()) return;
        commit();
        setFeedback(describeError(error, type.id, t, knownSecrets()));
        return;
      }
      if (stale()) return;
      commit();

      if (type.loadExtraFields === undefined) return;
      if (!requiredFilled(baseFields, vals)) {
        setExtras(IDLE);
        return;
      }
      setExtras({ status: 'loading', fields: [] });
      try {
        const fields = await type.loadExtraFields(
          { ...valuesOf(vals, baseFields), ...resolved },
          secrets,
          ctx,
        );
        if (stale()) return;
        setExtras({ status: 'ready', fields });
      } catch (error) {
        if (stale()) return;
        setExtras({ status: 'error', fields: [] });
        setFeedback(describeError(error, type.id, t, knownSecrets()));
      }
    },
    [
      baseFields,
      descendantsOf,
      knownSecrets,
      requiredFilled,
      secretsOf,
      t,
      type,
      uiLocale,
      valuesOf,
    ],
  );

  const runTest = useCallback(async () => {
    const myGen = ++gen.current;
    const stale = () => !alive.current || gen.current !== myGen;
    const vals = values;
    setTesting(true);
    setTested(null);
    setOptions({});
    setLoadingIds(NO_IDS);
    setExtras(IDLE);
    setFeedback(null);
    setSaveError(null);
    setWarning(false);

    let result;
    try {
      result = await type.test(
        valuesOf(vals, baseFields),
        secretsOf(vals),
        makeConnectorContext(uiLocale),
      );
    } catch (error) {
      // Lượt cũ (đã bị sửa ô / thử lại đè lên) không được tắt nút bận của lượt mới.
      if (stale()) return;
      setTesting(false);
      setFeedback(describeError(error, type.id, t, knownSecrets()));
      return;
    }
    if (stale()) return;
    setTesting(false);

    const resolved = omit(cleanValues(result.resolved), type.secretFieldIds);
    const opts: Options = { ...result.options };
    const cleared: string[] = [];
    for (const [fieldId, list] of Object.entries(opts)) {
      const v = vals[fieldId];
      if (typeof v === 'string' && !list.some((o) => o.id === v)) {
        cleared.push(fieldId, ...descendantsOf(fieldId));
      }
    }
    setValues((prev) => omit(prev, cleared));
    setOptions(opts);
    setTested({ resolved, account: result.account });
    await refresh(omit(vals, cleared), resolved, opts, myGen);
  }, [
    baseFields,
    descendantsOf,
    knownSecrets,
    refresh,
    secretsOf,
    t,
    type,
    uiLocale,
    valuesOf,
    values,
  ]);

  const extraIds = useMemo(() => new Set(extras.fields.map((f) => f.id)), [extras.fields]);

  const change = useCallback(
    (f: ConnectorField, next: ConnectionFieldValue) => {
      if (extraIds.has(f.id)) {
        setValues((prev) => ({ ...prev, [f.id]: next }));
        return;
      }
      if (isSecret(f)) {
        setDrafts((prev) => ({ ...prev, [f.id]: typeof next === 'string' ? next : '' }));
        invalidate();
        return;
      }
      const cleared = isChoice(f) ? descendantsOf(f.id) : [];
      const nextValues = { ...omit(values, cleared), [f.id]: next };
      setValues((prev) => ({ ...omit(prev, cleared), [f.id]: next }));
      if (!isDynamic(f)) {
        invalidate();
        return;
      }
      const myGen = ++gen.current;
      const nextOptions = omit(options, cleared);
      setTesting(false);
      setOptions(nextOptions);
      setLoadingIds(NO_IDS);
      setExtras(IDLE);
      setFeedback(null);
      setSaveError(null);
      setWarning(false);
      if (tested !== null) void refresh(nextValues, tested.resolved, nextOptions, myGen);
    },
    [descendantsOf, extraIds, invalidate, isSecret, options, refresh, tested, values],
  );

  const paste = useCallback(
    async (f: ConnectorField) => {
      const text = (await readText())?.trim();
      if (!text || !alive.current) return;
      setDrafts((prev) => ({ ...prev, [f.id]: text }));
      invalidate();
    },
    [invalidate],
  );

  const allFields = useMemo(() => [...baseFields, ...extras.fields], [baseFields, extras.fields]);
  const shown = allFields.filter((f) => isVisible(f, values));
  const unsupported = shown.some((f) => f.unsupportedType !== undefined);
  const missing = !requiredFilled(allFields, values);
  const extrasPending = type.loadExtraFields !== undefined && extras.status !== 'ready';
  const busy =
    testing || saving || loadingIds.size > 0 || extras.status === 'loading' || !secretsReady;
  const canSave = tested !== null && !unsupported && !missing && !extrasPending && !busy;
  const saveHint =
    tested === null
      ? 'connections.editor.needTest'
      : unsupported
        ? 'connections.editor.needSupported'
        : missing
          ? 'connections.editor.needRequired'
          : null;
  const inlineField =
    feedback?.field !== undefined && shown.some((f) => f.id === feedback.field)
      ? feedback.field
      : undefined;

  const persist = useCallback(async () => {
    // Ref chứ không phải state: hai cú bấm trong cùng một khung hình thấy cùng một `saving` cũ.
    if (tested === null || savingNow.current) return;
    savingNow.current = true;
    const connection: StoredConnection = {
      id,
      typeId: type.id,
      name: name.trim() || type.label(uiLocale),
      ticketLocale,
      values: { ...valuesOf(values, allFields), ...tested.resolved },
      createdAt,
    };
    const secrets = secretsOf(values);
    setWarning(false);
    setSaving(true);
    setSaveError(null);
    try {
      await connections.save(connection, secrets);
    } catch (error) {
      savingNow.current = false;
      if (isConnectionListCorrupt(error)) readFailures.current = 0;
      else readFailures.current = isConnectionStoreReadError(error) ? readFailures.current + 1 : 0;
      if (!alive.current) return;
      setSaving(false);
      if (isConnectionListCorrupt(error)) setSaveError('corrupt');
      else if (readFailures.current >= READ_FAILURES_BEFORE_RESET) setSaveError('unreadable');
      else setSaveError('failed');
      return;
    }
    savingNow.current = false;
    readFailures.current = 0;
    if (alive.current) {
      setSaving(false);
      setSaved(secrets);
      setDrafts({});
    }
    onSaved(connection);
  }, [
    allFields,
    connections,
    createdAt,
    id,
    name,
    onSaved,
    secretsOf,
    tested,
    ticketLocale,
    type,
    uiLocale,
    values,
    valuesOf,
  ]);

  const save = useCallback(() => {
    if (!canSave || tested === null) return;
    const next = { ...valuesOf(values, allFields), ...tested.resolved };
    const wasLongLived = initial !== undefined && type.longLivedSecret?.(initial.values) === true;
    if (type.longLivedSecret?.(next) === true && !wasLongLived && !warned.current) {
      setWarning(true);
      return;
    }
    void persist();
  }, [allFields, canSave, initial, persist, tested, type, values, valuesOf]);

  const confirmWarning = useCallback(() => {
    warned.current = true;
    void persist();
  }, [persist]);

  const afterReset = useCallback(() => {
    readFailures.current = 0;
    setSaveError(null);
  }, []);

  const optionsFor = (f: ConnectorField): readonly ConnectorOption[] | undefined =>
    options[f.id] ?? f.options;

  const hintFor = (f: ConnectorField): string | undefined => {
    if (!isChoice(f) || optionsFor(f) !== undefined) return undefined;
    if (loadingIds.has(f.id)) return t('connections.editor.optionsLoading');
    if (f.dependsOn !== undefined && !hasValue(values[f.dependsOn])) {
      const parent = baseFields.find((x) => x.id === f.dependsOn);
      return t('connections.editor.optionsAfterParent', { label: parent?.label ?? f.dependsOn });
    }
    return t('connections.editor.optionsAfterTest');
  };

  const renderField = (f: ConnectorField) => {
    const secret = isSecret(f);
    const kept = saved[f.id];
    return (
      <ConnectionField
        key={f.id}
        field={f}
        value={secret ? (drafts[f.id] ?? '') : values[f.id]}
        options={optionsFor(f)}
        optionsHint={hintFor(f)}
        error={inlineField === f.id ? feedback?.message : undefined}
        savedMasked={secret && kept !== undefined ? maskSecret(kept) : undefined}
        canPaste={secret && canPaste}
        onChange={(next) => change(f, next)}
        onPaste={() => void paste(f)}
      />
    );
  };

  return (
    <ScrollView
      testID="connection-editor"
      style={styles.root}
      contentContainerStyle={styles.body}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.pad}>
        <Text variant="bodyM_Medium">{t('connections.editor.name')}</Text>
        <TextInput
          testID="connection-editor-name"
          value={name}
          onChangeText={setName}
          accessibilityLabel={t('connections.editor.name')}
          keyboardAppearance={theme.mode}
          selectionColor={theme.colors.text.brand}
          autoCorrect={false}
          style={fieldStyles.input}
        />
      </View>

      {baseFields.filter((f) => isVisible(f, values)).map(renderField)}
      {extras.status === 'loading' ? (
        <View style={styles.pad}>
          <Text tone="tertiary">{t('connections.editor.extraLoading')}</Text>
        </View>
      ) : null}
      {extras.fields.filter((f) => isVisible(f, values)).map(renderField)}

      <View style={styles.pad}>
        <Text variant="bodyM_Medium">{t('connections.editor.ticketLocale')}</Text>
        <View style={styles.chips}>
          {LOCALES.map((locale) => {
            const selected = locale === ticketLocale;
            const label = t(
              locale === 'vi' ? 'connections.editor.localeVi' : 'connections.editor.localeEn',
            );
            return (
              <Pressable
                key={locale}
                testID={`connection-editor-locale-${locale}`}
                accessibilityRole="button"
                accessibilityLabel={label}
                accessibilityState={{ selected }}
                onPress={() => setTicketLocale(locale)}
              >
                <Chip label={label} state={selected ? 'active' : 'default'} />
              </Pressable>
            );
          })}
        </View>
        <Text tone="tertiary">{t('connections.editor.ticketLocaleHelp')}</Text>
      </View>

      {feedback !== null && inlineField === undefined ? (
        <View testID="connection-editor-error" style={styles.pad}>
          <Text tone="danger">{feedback.message}</Text>
          {feedback.detail !== undefined ? <Text tone="tertiary">{feedback.detail}</Text> : null}
        </View>
      ) : null}
      {tested !== null ? (
        <View style={styles.pad}>
          <Text testID="connection-editor-test-ok" tone="success">
            {tested.account !== undefined
              ? t('connections.editor.testOkAccount', { account: tested.account })
              : t('connections.editor.testOk')}
          </Text>
        </View>
      ) : null}
      {warning ? (
        <View style={styles.pad}>
          <View testID="connection-editor-warning" style={styles.warning}>
            <Text variant="bodyM_Medium" tone="warning">
              {t('connections.editor.longLivedTitle')}
            </Text>
            <Text>{t('connections.editor.longLived')}</Text>
            <View style={styles.actions}>
              <Button
                testID="connection-editor-warning-confirm"
                label={t('connections.editor.longLivedConfirm')}
                size="sm"
                onPress={confirmWarning}
              />
              <Button
                testID="connection-editor-warning-cancel"
                label={t('connections.editor.cancel')}
                variant="tertiary"
                size="sm"
                onPress={() => setWarning(false)}
              />
            </View>
          </View>
        </View>
      ) : null}
      {saveError === 'corrupt' || saveError === 'unreadable' ? (
        <View style={styles.pad}>
          <ResetConnectionsNotice
            testID={`connection-editor-${saveError}`}
            reason={saveError}
            connections={connections}
            onReset={afterReset}
          />
        </View>
      ) : null}
      {saveError === 'failed' ? (
        <View style={styles.pad}>
          <Text tone="danger">{t('connections.editor.saveFailed')}</Text>
        </View>
      ) : null}

      <View style={styles.pad}>
        <View style={styles.actions}>
          <Button
            testID="connection-editor-test"
            label={t('connections.editor.test')}
            variant="secondary"
            loading={testing}
            disabled={saving || !secretsReady}
            onPress={() => void runTest()}
          />
          <Button
            testID="connection-editor-save"
            label={t('connections.editor.save')}
            loading={saving}
            disabled={!canSave}
            onPress={save}
          />
          <Button
            testID="connection-editor-cancel"
            label={t('connections.editor.cancel')}
            variant="tertiary"
            onPress={onCancel}
          />
        </View>
        {saveHint !== null && !busy ? (
          <Text testID="connection-editor-save-hint" tone="tertiary">
            {t(saveHint)}
          </Text>
        ) : null}
      </View>
    </ScrollView>
  );
};
