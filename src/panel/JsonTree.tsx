import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, Text as RNText, View } from 'react-native';
import { Text } from '../ui/Text';
import { useStyles, useTheme } from '../ui/use-styles';
import type { DevToolsTheme } from '../ui/theme';
import { useDevToolsT } from '../i18n';
import { copyText } from './copy-text';
import { SYNTAX_KEY_WEIGHT, syntaxColorsOf } from './syntax-colors';

/** Giá trị JSON đã parse. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** Font đơn cách — thụt lề và cột mới thẳng hàng. Không có token font mono nên chọn theo nền tảng. */
export const MONO_FONT = Platform.select({ ios: 'Menlo', default: 'monospace' });

/** Tầng mở sẵn: gốc + một tầng con. Sâu hơn gập lại, hiện tóm tắt. */
const DEFAULT_OPEN_DEPTH = 2;
/** Mảng dài hiện từng đợt — mở một mảng 500 phần tử không được dựng 500 hàng một lúc. */
const CHUNK = 50;
/** Chuỗi dài hơn mức này chỉ hiện 3 dòng, chạm để mở hết. */
const LONG_STRING = 160;
const COPIED_MS = 1500;

const isContainer = (value: JsonValue): value is JsonValue[] | { [key: string]: JsonValue } =>
  typeof value === 'object' && value !== null;

/** ⚠️ Hằng module-scope — cùng lý do với `DevToolsRow` (cache của `useStyles` khoá theo tham chiếu). */
const stylesOf = (t: DevToolsTheme) => ({
  row: {
    paddingVertical: t.spacing['2xs'],
  },
  mono: { fontFamily: MONO_FONT },
  more: {
    paddingVertical: t.spacing.xs,
  },
  indentUnit: { width: t.spacing.md },
});

interface JsonNodeProps {
  /** Tên khoá (object) hoặc chỉ số (mảng); `undefined` ở gốc. */
  name?: string;
  value: JsonValue;
  depth: number;
}

/**
 * Một hàng của cây — khoá, rồi giá trị (nguyên thuỷ) hoặc tóm tắt + con (object/mảng).
 * `memo`: mở một nhánh chỉ render lại nhánh đó, không render lại anh em.
 */
const JsonNode = memo(({ name, value, depth }: JsonNodeProps) => {
  const t = useDevToolsT();
  const theme = useTheme();
  const syntax = useMemo(() => syntaxColorsOf(theme), [theme]);
  const styles = useStyles(stylesOf);
  const container = isContainer(value);
  const [open, setOpen] = useState(depth < DEFAULT_OPEN_DEPTH);
  const [limit, setLimit] = useState(CHUNK);
  const [wholeString, setWholeString] = useState(false);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  /* Chỉ liệt kê con khi nhánh đang MỞ — gập thì không tốn gì dù bên trong có nghìn phần tử. */
  const children = useMemo<[string, JsonValue][]>(() => {
    if (!container || !open) return [];
    return Array.isArray(value) ? value.map((v, i) => [String(i), v]) : Object.entries(value);
  }, [container, open, value]);

  const size = container ? (Array.isArray(value) ? value.length : Object.keys(value).length) : 0;
  const longString = typeof value === 'string' && value.length > LONG_STRING;

  const press = () => {
    if (container) setOpen((v) => !v);
    else if (longString) setWholeString((v) => !v);
  };
  const copy = () => {
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    if (!copyText(text)) return;
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
  };

  const valueColor =
    typeof value === 'string' ? syntax.string : typeof value === 'number' ? syntax.number : syntax.literal;
  const summary = container
    ? Array.isArray(value)
      ? t('log.jsonArrayCount', { count: size })
      : t('log.jsonObjectCount', { count: size })
    : undefined;
  const caret = container ? (open ? '▾ ' : '▸ ') : '  '; // ký hiệu gập/mở của cây

  return (
    <>
      <Pressable
        testID={`json-node-${depth}-${name ?? 'root'}`}
        accessibilityRole="button"
        accessibilityState={container ? { expanded: open } : undefined}
        onPress={press}
        onLongPress={copy}
        style={[styles.row, { paddingLeft: depth * styles.indentUnit.width }]}
      >
        <Text
          variant="captionS_Regular"
          tone="primary"
          style={styles.mono}
          numberOfLines={longString && !wholeString ? 3 : undefined}
        >
          <RNText style={{ color: syntax.punct }}>{caret}</RNText>
          {name !== undefined ? (
            <>
              <RNText style={{ color: syntax.key, fontWeight: SYNTAX_KEY_WEIGHT }}>{name}</RNText>
              <RNText style={{ color: syntax.punct }}>{': '}</RNText>
            </>
          ) : null}
          {container ? (
            <RNText style={{ color: syntax.punct }}>{summary}</RNText>
          ) : (
            <RNText style={{ color: valueColor }}>
              {typeof value === 'string' ? JSON.stringify(value) : String(value)}
            </RNText>
          )}
          {copied ? (
            <RNText style={{ color: syntax.string }}>{`  ✓ ${t('log.copied')}`}</RNText>
          ) : null}
        </Text>
      </Pressable>
      {children.slice(0, limit).map(([key, child]) => (
        <JsonNode key={key} name={key} value={child} depth={depth + 1} />
      ))}
      {children.length > limit ? (
        <Pressable
          testID={`json-more-${depth}-${name ?? 'root'}`}
          accessibilityRole="button"
          onPress={() => setLimit((n) => n + CHUNK)}
          style={[styles.more, { paddingLeft: (depth + 1) * styles.indentUnit.width }]}
        >
          <Text variant="captionS_Medium" tone="brand">
            {t('log.jsonShowMore', { count: children.length - limit })}
          </Text>
        </Pressable>
      ) : null}
    </>
  );
});
JsonNode.displayName = 'JsonNode';

export interface JsonTreeProps {
  value: JsonValue;
}

/**
 * **Chức năng:** cây JSON gập/mở được cho tab Request · Response của màn chi tiết — chạm một hàng
 * object/mảng để mở/gập, chạm chuỗi dài để mở hết, **giữ** một hàng để chép đúng nhánh đó.
 *
 * ## Vì sao cây, khi đã có văn bản dàn dòng
 *
 * Response danh sách 20 phần tử dàn ra là vài trăm dòng — tìm `data.items[7].status` là cuộn. Cây
 * mở sẵn **hai tầng** (gốc + tầng con), tầng sâu hơn gập lại với tóm tắt (`20 phần tử` · `8 khoá`),
 * nên nhìn một lượt là thấy hình dạng response; mảng dài hiện từng đợt {@link CHUNK} phần tử.
 *
 * Màu lấy từ {@link syntaxColorsOf} (khoá xanh dương **đậm** · chuỗi xanh lá · số cam · bool/null
 * đỏ · dấu câu xám), mọi cặp ≥ 5,3:1 trên nền khối code ở cả sáng lẫn tối.
 *
 * **Input:** `value` — JSON **đã che** rồi parse (che trên chuỗi trước khi parse, xem `JsonBody`).
 * **Output:** các hàng của cây (không tự cuộn — đặt trong `BottomSheetScrollView` của trang).
 *
 * @example
 * ```tsx
 * <JsonTree value={{ code: 200, data: { items: [{ id: 1 }] } }} />
 * // ▾ code: 200 · ▾ data: … · ▸ items: 1 phần tử
 * // Ca biên: value là chuỗi trần ⇒ một hàng, không caret.
 * ```
 *
 * **Unit test:** `JsonTree.test.tsx` › `JsonTree` — 4 case: tầng 0–1 mở sẵn, tầng 2 gập với tóm
 * tắt · chạm nhánh gập ⇒ con hiện ra · mảng dài hơn {@link CHUNK} ⇒ nút "Xem thêm" hiện đợt tiếp ·
 * giữ một hàng ⇒ `copyText` nhận JSON của đúng nhánh.
 */
export const JsonTree = ({ value }: JsonTreeProps) => (
  <View testID="json-tree">
    <JsonNode value={value} depth={0} />
  </View>
);
