import { useMemo, useState } from 'react';
import { Text as RNText, View } from 'react-native';
import { Text } from '../ui/Text';
import { useStyles, useTheme } from '../ui/use-styles';
import type { DevToolsTheme } from '../ui/theme';
import { prettyBody } from '../capture/format-error-report';
import { tokenizeJson } from '../capture/format-json';
import { redactBody } from '../capture/redact';
import { useDevToolsT } from '../i18n';
import { JsonTree, MONO_FONT, type JsonValue } from './JsonTree';
import { FilterChip } from './LogToolbar';
import { SYNTAX_KEY_WEIGHT, syntaxColorsOf } from './syntax-colors';

/** Văn bản dài hơn mức này thì không tô màu — mỗi đoạn màu là một `Text` lồng, 256 KB là hàng chục nghìn đoạn. */
const COLOR_LIMIT = 30_000;

type BodyView = 'tree' | 'text';

const stylesOf = (t: DevToolsTheme) => ({
  root: { gap: t.spacing.sm },
  views: { flexDirection: 'row' as const, gap: t.spacing.sm },
  /*
    Nền `surface` + viền mảnh, KHÔNG `surfaceAlt`: nền xám làm màu cú pháp tụt dưới 3:1 (đo với
    bảng màu mặc định lúc viết, xem `syntax-colors.ts`).
  */
  code: {
    padding: t.spacing.sm,
    borderRadius: t.radius.sm,
    borderWidth: t.borderWidth.thin,
    borderColor: t.colors.border.subtle,
    backgroundColor: t.colors.background.surface,
  },
  mono: { fontFamily: MONO_FONT },
});

/** Parse thân **đã che**; `undefined` khi không phải JSON hợp lệ (bị cắt, HTML, chuỗi trần). */
const parseSafe = (raw: string): JsonValue | undefined => {
  try {
    return JSON.parse(raw) as JsonValue;
  } catch {
    return undefined;
  }
};

/** `12.4 KB` · `830 B` — đọc nhanh độ lớn thân, không cần chính xác tới byte. */
const sizeOf = (text: string) =>
  text.length < 1024 ? `${text.length} B` : `${(text.length / 1024).toFixed(1)} KB`; // đơn vị đo

/** Số khoá cấp 1 in ra trong dòng tóm tắt — đủ để nhận ra response, không tràn dòng. */
const SUMMARY_KEYS = 6;

export interface JsonBodyProps {
  /** Thân **thô** (chưa che) — có thể là bản đầy đủ từ kho hoặc bản 4 KB của nhật ký. */
  raw: string;
  testID: string;
}

/**
 * **Chức năng:** khung xem một thân request/response — dòng tóm tắt, hai chip **Cây · Văn bản**,
 * rồi cây JSON gập/mở được ({@link JsonTree}) hoặc văn bản đã dàn dòng, font đơn cách, tô màu.
 *
 * - Thân parse được ⇒ mở **Cây** sẵn; dòng tóm tắt in kích thước + khoá cấp 1 / độ dài mảng.
 * - Không parse được (bị cắt, không phải JSON) ⇒ chỉ **Văn bản**, dàn bằng `formatJsonLenient`
 *   nên JSON bị cắt vẫn thụt lề đúng, kèm câu báo vì sao không có cây.
 * - Văn bản dài hơn {@link COLOR_LIMIT} ký tự thì bỏ tô màu (vẫn đơn cách).
 *
 * 🔴 Che **trên chuỗi** trước khi parse (`redactBody` khớp khuôn `"khoá":"giá trị"` liền nhau) —
 * parse trước rồi mới che là phải đi lại cả cây.
 *
 * **Input:** `raw` · `testID`. **Output:** JSX.
 *
 * @example
 * ```tsx
 * <JsonBody raw='{"code":200,"data":[1,2]}' testID="devtools-detail-response" />
 * // 26 B · 2 khoá: code, data   [Cây] [Văn bản]
 * // Ca biên: raw '{"a":[1,…+900' ⇒ chỉ Văn bản + câu "Không dựng được cây".
 * ```
 *
 * **Unit test:** `JsonBody.test.tsx` › `JsonBody` — 4 case: JSON hợp lệ ⇒ tóm tắt + cây mặc định ·
 * đổi chip sang Văn bản ⇒ văn bản dàn dòng · thân bị cắt ⇒ chỉ văn bản + câu báo · khoá `password`
 * bị che trong cả cây lẫn văn bản.
 */
export const JsonBody = ({ raw, testID }: JsonBodyProps) => {
  const t = useDevToolsT();
  const theme = useTheme();
  const colorOf = useMemo(() => syntaxColorsOf(theme), [theme]);
  const styles = useStyles(stylesOf);
  const [view, setView] = useState<BodyView>('tree');

  const safe = useMemo(() => redactBody(raw) ?? '', [raw]);
  const parsed = useMemo(() => parseSafe(safe), [safe]);
  const canTree = parsed !== undefined && typeof parsed === 'object' && parsed !== null;
  const shown: BodyView = canTree ? view : 'text';

  /* Văn bản chỉ dựng khi đang xem văn bản — cây không cần nó. */
  const text = useMemo(() => (shown === 'text' ? (prettyBody(raw) ?? '') : ''), [raw, shown]);
  const tokens = useMemo(
    () => (shown === 'text' && text.length <= COLOR_LIMIT ? tokenizeJson(text) : undefined),
    [shown, text],
  );

  const summary = !canTree
    ? undefined
    : Array.isArray(parsed)
      ? t('log.jsonArraySummary', { size: sizeOf(raw), count: parsed.length })
      : t('log.jsonObjectSummary', {
          size: sizeOf(raw),
          count: Object.keys(parsed).length,
          keys: Object.keys(parsed).slice(0, SUMMARY_KEYS).join(', '),
        });

  return (
    <View style={styles.root} testID={testID}>
      {canTree ? (
        <>
          <Text variant="captionS_Medium" tone="secondary" testID={`${testID}-summary`}>
            {summary}
          </Text>
          <View style={styles.views}>
            <FilterChip
              testID={`${testID}-view-tree`}
              label={t('log.viewTree')}
              selected={shown === 'tree'}
              onPress={() => setView('tree')}
            />
            <FilterChip
              testID={`${testID}-view-text`}
              label={t('log.viewText')}
              selected={shown === 'text'}
              onPress={() => setView('text')}
            />
          </View>
        </>
      ) : (
        <Text variant="captionS_Regular" tone="secondary">
          {t('log.treeUnavailable')}
        </Text>
      )}

      {shown === 'tree' && canTree ? (
        <>
          <Text variant="captionS_Regular" tone="tertiary">
            {t('log.treeHint')}
          </Text>
          <View style={styles.code}>
            <JsonTree value={parsed} />
          </View>
        </>
      ) : (
        <View style={styles.code}>
          <Text
            variant="captionS_Regular"
            tone="primary"
            style={styles.mono}
            selectable
            testID={`${testID}-text`}
          >
            {tokens
              ? tokens.map((token, i) => (
                  <RNText
                    key={i}
                    style={{
                      color: colorOf[token.kind],
                      fontWeight: token.kind === 'key' ? SYNTAX_KEY_WEIGHT : undefined,
                    }}
                  >
                    {token.text}
                  </RNText>
                ))
              : text}
          </Text>
        </View>
      )}
    </View>
  );
};
