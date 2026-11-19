import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import type { DevToolsLocale } from '../../i18n/types';
import { useDevToolsT } from '../../i18n/use-devtools-t';
import { Button } from '../../ui/Button';
import { useDevToolsUi } from '../../ui/context';
import { useSheetKit } from '../../ui/sheet-kit';
import { Text } from '../../ui/Text';
import type { DevToolsTheme } from '../../ui/theme';
import { useStyles } from '../../ui/use-styles';
import {
  isConnectionListCorrupt,
  isConnectionStoreReadError,
  maskSecret,
  type ConnectionStore,
  type StoredConnection,
} from '../connections/connection-store';
import type { ConnectorType } from '../connectors/types';
import {
  READ_FAILURES_BEFORE_RESET,
  ResetConnectionsNotice,
  type ResetReason,
} from './ResetConnectionsNotice';

const stylesOf = (t: DevToolsTheme) => ({
  root: { backgroundColor: t.colors.background.surface },
  body: { gap: t.spacing.sm, paddingVertical: t.spacing.md },
  pad: { paddingHorizontal: t.spacing.md, gap: t.spacing.xs },
  row: {
    gap: t.spacing['2xs'],
    paddingVertical: t.spacing.sm,
    paddingHorizontal: t.spacing.md,
    backgroundColor: t.colors.background.surface,
    borderBottomWidth: t.borderWidth.thin,
    borderBottomColor: t.colors.border.subtle,
  },
  actions: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: t.spacing.xs },
});

export interface ConnectionsPageProps {
  /** `null` khi app không cấp `secureStore` (spec 5.5). */
  connections: ConnectionStore | null;
  /** Mọi loại kết nối đang có (`mergeConnectorTypes(config.bugReport.connectorTypes)`). */
  connectorTypes: readonly ConnectorType[];
  /** QA chọn loại cho kết nối mới ⇒ chỗ chứa mở `ConnectionEditor` với loại đó. */
  onAdd: (type: ConnectorType) => void;
  /** QA bấm Sửa ⇒ chỗ chứa mở `ConnectionEditor` với `initial` là kết nối đó. */
  onEdit: (connection: StoredConnection) => void;
  /** Nút Quay lại. */
  onBack: () => void;
}

/** Một hàng đã dựng sẵn chữ — bí mật chỉ còn dạng che, không giữ bản gốc trong state. */
interface Row {
  readonly connection: StoredConnection;
  readonly type?: ConnectorType;
  readonly subtitle: string;
  readonly secretHint?: string;
}

type Load =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly rows: readonly Row[] }
  | { readonly status: 'reset'; readonly reason: ResetReason }
  | { readonly status: 'error' };

/** Mức của kết nối: gửi được ảnh hoặc file ⇒ Đầy đủ, không thì Nhẹ. Hàm của loại ném ⇒ không ghi mức. */
const isFull = (type: ConnectorType, c: StoredConnection): boolean | undefined => {
  try {
    const caps = type.capabilities(c.values);
    return caps.image || caps.files;
  } catch {
    return undefined;
  }
};

/**
 * **Chức năng:** trang **Kết nối** (spec 5.4 tầng "kết nối", 5.5) — thân của một trang trong sheet
 * báo bug (sheet chứa nó đặt tiêu đề `connections.page.title`). Gốc là `SheetKit.ScrollView`, nên
 * sheet chứa dùng `contentMode="scrollable"`.
 *
 * - `connections === null` ⇒ chỉ một câu "App chưa cấp kho bảo mật" (+ Quay lại).
 * - Danh sách: tên · `<loại> · <Nhẹ|Đầy đủ>` (mức theo `capabilities`) · bí mật đầu tiên đã lưu ở
 *   dạng `<nhãn ô> ••••xxxx` (`maskSecret`). Bản gốc của bí mật không bao giờ vào state hay màn.
 * - "+ Thêm kết nối" ⇒ chọn loại ⇒ `onAdd(loại)`. Sửa ⇒ `onEdit(kết nối)` (kết nối trỏ tới loại app
 *   đã gỡ thì không sửa được, vẫn xoá được). Xoá hỏi lại một lần ngay trên hàng (không `Modal`).
 * - Danh sách hỏng (`list`/`remove` ném `ConnectionListCorruptError`) ⇒ thay danh sách bằng khối
 *   "Đặt lại kết nối" (`resetAll`, ruling R18) rồi tải lại. Xoá hỏng vì kho ném khi đọc
 *   (`ConnectionStoreReadError`): lần đầu chỉ báo lỗi; lần thứ hai liền nhau ⇒ cũng khối Đặt lại, với
 *   câu cảnh báo mọi kết nối và bí mật sẽ bị xoá (R39). Xoá thành công hoặc lỗi khác ⇒ đếm lại từ 0.
 *   Lỗi kho khác ⇒ câu lỗi, không đặt lại.
 * - Cờ "còn gắn" đặt lại `true` trong effect (an toàn với StrictMode: gắn → dọn → gắn lại).
 *
 * **Input:** {@link ConnectionsPageProps}. **Output:** thân trang.
 *
 * @example
 * ```tsx
 * <ConnectionsPage connections={connections} connectorTypes={types}
 *   onAdd={(type) => openEditor({ type })} onEdit={(c) => openEditor({ initial: c })} onBack={back} />
 * // Ca biên: connections={null} ⇒ chỉ "App chưa cấp kho bảo mật".
 * ```
 *
 * **Unit test:** `ConnectionsPage.test.tsx` — 19 case × 2 kit (gorhom, plain): không có kho · tên,
 * loại · mức, bí mật che · danh sách trống · thêm → chọn loại (và Huỷ) · Sửa, Quay lại · xoá hỏi lại
 * (Huỷ / Xoá hẳn) · xoá lỗi thường · xoá ném danh sách hỏng → Đặt lại → tải lại · list ném danh sách
 * hỏng + đặt lại lỗi · list lỗi khác · xoá hỏng vì đọc kho một lần / hai lần liền (đếm lại sau thành
 * công) · StrictMode: trang tải xong · StrictMode: khối Đặt lại thôi bận (trong trang và gắn trực
 * tiếp) · loại đã gỡ · màu sáng/tối (2) của danh sách và của câu không có kho; cộng 1 case tiếng Anh.
 */
export const ConnectionsPage = (props: ConnectionsPageProps) => {
  const { ScrollView } = useSheetKit();
  const styles = useStyles(stylesOf);
  const t = useDevToolsT();
  const { connections, onBack } = props;

  return (
    <ScrollView
      testID="connections-page"
      style={styles.root}
      contentContainerStyle={styles.body}
      keyboardShouldPersistTaps="handled"
    >
      {connections === null ? (
        <View style={styles.pad}>
          <Text testID="connections-no-store" variant="bodyM_Medium" tone="secondary">
            {t('connections.page.noSecureStore')}
          </Text>
        </View>
      ) : (
        <ConnectionList {...props} connections={connections} />
      )}
      <View style={styles.pad}>
        <Button
          testID="connections-back"
          label={t('connections.page.back')}
          variant="tertiary"
          onPress={onBack}
        />
      </View>
    </ScrollView>
  );
};

/** Phần có kho: danh sách + thêm + xoá + đặt lại. */
const ConnectionList = ({
  connections,
  connectorTypes,
  onAdd,
  onEdit,
}: ConnectionsPageProps & { connections: ConnectionStore }) => {
  const styles = useStyles(stylesOf);
  const t = useDevToolsT();
  const { locale } = useDevToolsUi();
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [choosing, setChoosing] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleteFailed, setDeleteFailed] = useState(false);
  /** Số lần xoá liền nhau hỏng vì kho ném khi đọc (R39). */
  const readFailures = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    // Đặt lại trong effect: StrictMode chạy gắn → dọn → gắn lại trên cùng một ref.
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    try {
      const list = await connections.list();
      const rows = await Promise.all(
        list.map((c) => rowOf(c, connectorTypes, connections, locale, t)),
      );
      if (alive.current) setLoad({ status: 'ready', rows });
    } catch (error) {
      if (!alive.current) return;
      setLoad(
        isConnectionListCorrupt(error) ? { status: 'reset', reason: 'corrupt' } : { status: 'error' },
      );
    }
  }, [connections, connectorTypes, locale, t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const remove = useCallback(
    async (id: string) => {
      setConfirming(null);
      setDeleteFailed(false);
      try {
        await connections.remove(id);
      } catch (error) {
        if (!alive.current) return;
        if (isConnectionListCorrupt(error)) {
          readFailures.current = 0;
          setLoad({ status: 'reset', reason: 'corrupt' });
          return;
        }
        readFailures.current = isConnectionStoreReadError(error) ? readFailures.current + 1 : 0;
        if (readFailures.current >= READ_FAILURES_BEFORE_RESET) {
          setLoad({ status: 'reset', reason: 'unreadable' });
        } else {
          setDeleteFailed(true);
        }
        return;
      }
      readFailures.current = 0;
      await reload();
    },
    [connections, reload],
  );

  const afterReset = useCallback(async () => {
    readFailures.current = 0;
    await reload();
  }, [reload]);

  if (load.status === 'reset') {
    return (
      <View style={styles.pad}>
        <ResetConnectionsNotice
          testID={`connections-${load.reason}`}
          reason={load.reason}
          connections={connections}
          onReset={afterReset}
        />
      </View>
    );
  }

  return (
    <>
      {load.status === 'loading' ? (
        <View style={styles.pad}>
          <Text tone="tertiary">{t('connections.page.loading')}</Text>
        </View>
      ) : null}
      {load.status === 'error' ? (
        <View style={styles.pad}>
          <Text testID="connections-error" tone="danger">
            {t('connections.page.loadFailed')}
          </Text>
        </View>
      ) : null}
      {load.status === 'ready' && load.rows.length === 0 ? (
        <View style={styles.pad}>
          <Text testID="connections-empty" variant="bodyM_Medium" tone="secondary">
            {t('connections.page.empty')}
          </Text>
        </View>
      ) : null}
      {load.status === 'ready'
        ? load.rows.map((row) => (
            <ConnectionRow
              key={row.connection.id}
              row={row}
              confirming={confirming === row.connection.id}
              onEdit={onEdit}
              onAskDelete={setConfirming}
              onDelete={remove}
            />
          ))
        : null}
      {deleteFailed ? (
        <View style={styles.pad}>
          <Text testID="connections-delete-failed" tone="danger">
            {t('connections.page.deleteFailed')}
          </Text>
        </View>
      ) : null}
      {connectorTypes.length > 0 ? (
        <View style={styles.pad}>
          {choosing ? (
            <>
              <Text variant="bodyM_Medium">{t('connections.page.chooseType')}</Text>
              <View style={styles.actions}>
                {connectorTypes.map((type) => (
                  <Button
                    key={type.id}
                    testID={`connections-type-${type.id}`}
                    label={type.label(locale)}
                    variant="secondary"
                    size="sm"
                    onPress={() => {
                      setChoosing(false);
                      onAdd(type);
                    }}
                  />
                ))}
                <Button
                  testID="connections-type-cancel"
                  label={t('connections.page.cancel')}
                  variant="tertiary"
                  size="sm"
                  onPress={() => setChoosing(false)}
                />
              </View>
            </>
          ) : (
            <Button
              testID="connections-add"
              label={t('connections.page.add')}
              variant="secondary"
              onPress={() => setChoosing(true)}
            />
          )}
        </View>
      ) : null}
    </>
  );
};

/** Dựng chữ của một hàng. Đọc bí mật chỉ để lấy dạng che; bản gốc không ra khỏi hàm này. */
const rowOf = async (
  connection: StoredConnection,
  types: readonly ConnectorType[],
  connections: ConnectionStore,
  locale: DevToolsLocale,
  t: ReturnType<typeof useDevToolsT>,
): Promise<Row> => {
  const type = types.find((x) => x.id === connection.typeId);
  if (type === undefined) {
    return { connection, subtitle: t('connections.page.unknownType', { id: connection.typeId }) };
  }
  const full = isFull(type, connection);
  const label = type.label(locale);
  const subtitle =
    full === undefined
      ? label
      : t('connections.page.rowSubtitle', {
          type: label,
          level: t(full ? 'connections.page.levelFull' : 'connections.page.levelLight'),
        });

  const secrets = await connections.secrets(connection.id);
  const secretId = type.secretFieldIds.find((id) => {
    const v = secrets?.[id];
    return typeof v === 'string' && v !== '';
  });
  if (secretId === undefined) return { connection, type, subtitle };
  const fieldLabel = type.fields(locale).find((f) => f.id === secretId)?.label ?? secretId;
  const masked = maskSecret(secrets?.[secretId] as string);
  return {
    connection,
    type,
    subtitle,
    secretHint: t('connections.page.secretHint', { label: fieldLabel, masked }),
  };
};

interface ConnectionRowProps {
  row: Row;
  confirming: boolean;
  onEdit: (c: StoredConnection) => void;
  onAskDelete: (id: string | null) => void;
  onDelete: (id: string) => void;
}

const ConnectionRow = ({ row, confirming, onEdit, onAskDelete, onDelete }: ConnectionRowProps) => {
  const styles = useStyles(stylesOf);
  const t = useDevToolsT();
  const { connection, type, subtitle, secretHint } = row;
  const base = `connection-row-${connection.id}`;

  return (
    <View testID={base} style={styles.row}>
      <Text variant="bodyM_Medium">{connection.name}</Text>
      <Text tone="secondary">{subtitle}</Text>
      {secretHint !== undefined ? <Text tone="tertiary">{secretHint}</Text> : null}
      {confirming ? (
        <>
          <Text tone="danger">
            {t('connections.page.deleteConfirm', { name: connection.name })}
          </Text>
          <View style={styles.actions}>
            <Button
              testID={`${base}-confirm`}
              label={t('connections.page.deleteYes')}
              size="sm"
              onPress={() => onDelete(connection.id)}
            />
            <Button
              testID={`${base}-cancel`}
              label={t('connections.page.cancel')}
              variant="tertiary"
              size="sm"
              onPress={() => onAskDelete(null)}
            />
          </View>
        </>
      ) : (
        <View style={styles.actions}>
          {type !== undefined ? (
            <Button
              testID={`${base}-edit`}
              label={t('connections.page.edit')}
              accessibilityLabel={t('connections.page.editA11y', { name: connection.name })}
              variant="secondary"
              size="sm"
              onPress={() => onEdit(connection)}
            />
          ) : null}
          <Button
            testID={`${base}-delete`}
            label={t('connections.page.delete')}
            accessibilityLabel={t('connections.page.deleteA11y', { name: connection.name })}
            variant="tertiary"
            size="sm"
            onPress={() => onAskDelete(connection.id)}
          />
        </View>
      )}
    </View>
  );
};
