import { View } from 'react-native';
import { useDevToolsT } from '../../i18n';
import type { DevToolsKey, DevToolsStrings, TVars } from '../../i18n/types';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { useSheetKit } from '../../ui/sheet-kit';
import { Text } from '../../ui/Text';
import type { DevToolsTheme } from '../../ui/theme';
import { useStyles, useTheme } from '../../ui/use-styles';
import type { ReportDraft } from '../bug-report';
import { renderStep, type ReportStep } from '../steps';

/** ⚠️ Hằng module-scope — `useStyles` nhớ theo tham chiếu factory. */
const stylesOf = (t: DevToolsTheme) => ({
  root: { gap: t.spacing.sm },
  row: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: t.spacing['2xs'],
  },
  index: { minWidth: t.spacing.md, paddingTop: t.spacing.xs },
  input: {
    flex: 1,
    minHeight: t.size.field,
    paddingHorizontal: t.spacing.sm,
    paddingVertical: t.spacing.xs,
    borderRadius: t.radius.md,
    borderWidth: t.borderWidth.thin,
    borderColor: t.colors.border.strong,
    backgroundColor: t.colors.background.surface,
    ...t.typography.bodyM_Medium,
    fontWeight: '400' as const,
    color: t.colors.text.primary,
  },
  actions: { flexDirection: 'row' as const },
});

/** `HH:mm` theo giờ máy — đủ để QA nhận ra mốc trong buổi thử. */
const hhmm = (at: number): string => {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
};

/**
 * **Chức năng:** dòng ghi chú đầu trang các bước — các bước tính từ đâu (spec 4.3.3).
 *
 * - Nháp sau crash ⇒ các bước lấy từ phiên trước (`draft.window` khi đó là cửa sổ của phiên này,
 *   không phải nguồn của các bước).
 * - `mark` ⇒ `Ghi từ mốc ⚑ #2 lúc 10:42` · `sent` ⇒ `Ghi từ lần gửi trước lúc 11:05` · `session` ⇒
 *   `Ghi từ lúc mở app`.
 *
 * **Input:** `draft` (`window`, `crash`) · `t`. **Output:** câu đã dịch.
 *
 * @example
 * ```ts
 * stepsNote({ window: { from: at1042, source: 'mark', markLabel: '2' } }, t);
 * // 'Ghi từ mốc ⚑ #2 lúc 10:42'
 * stepsNote({ window: { from: 0, source: 'session' }, crash: { sessionName: 's.json' } }, t);
 * // ca biên: 'Các bước của phiên trước, trước khi app crash'
 * ```
 *
 * **Unit test:** `ReportSheet.test.tsx` › `trang sửa các bước` — 4 case: mốc ⚑ · lúc mở app · lần
 * gửi trước · nháp sau crash.
 */
export const stepsNote = (
  draft: Pick<ReportDraft, 'window' | 'crash'>,
  t: (key: DevToolsKey, vars?: TVars) => string,
): string => {
  if (draft.crash) return t('report.editor.noteCrash');
  const { window } = draft;
  switch (window.source) {
    case 'mark':
      return t('report.editor.noteMark', {
        label: window.markLabel ?? '',
        time: hhmm(window.from),
      });
    case 'sent':
      return t('report.editor.noteSent', { time: hhmm(window.from) });
    case 'session':
      return t('report.editor.noteSession');
  }
};

/**
 * **Chức năng:** đổi chỗ bước `index` với bước kề trên (`-1`) hoặc kề dưới (`+1`). Ra ngoài mảng ⇒
 * trả nguyên mảng.
 *
 * **Input:** `steps` · `index` · `delta` (`-1` | `1`). **Output:** mảng mới (hoặc chính `steps`).
 *
 * @example
 * ```ts
 * moveStep([a, b, c], 1, -1);   // [b, a, c]
 * moveStep([a, b, c], 2, 1);    // ca biên: bước cuối không xuống được ⇒ [a, b, c]
 * ```
 *
 * **Unit test:** `ReportSheet.test.tsx` › `trang sửa các bước` — case ▲/▼ (lên đầu, nút biên khoá).
 */
export const moveStep = (
  steps: readonly ReportStep[],
  index: number,
  delta: -1 | 1,
): readonly ReportStep[] => {
  const target = index + delta;
  const a = steps[index];
  const b = steps[target];
  if (!a || !b) return steps;
  const next = steps.slice();
  next[index] = b;
  next[target] = a;
  return next;
};

/**
 * **Chức năng:** QA sửa chữ một bước ⇒ bước thành **chữ tự do** (`kind: 'text'`, spec 11.2): gửi
 * đúng chữ QA gõ, không dịch theo ngôn ngữ của kết nối. Giữ `id` (khoá hàng) và `at`.
 *
 * **Input:** `steps` · `index` · `text`. **Output:** mảng mới.
 *
 * @example
 * ```ts
 * editStep([{ id: 'a', kind: 'tap', at: 1, label: 'Pay', count: 2 }], 0, 'Chạm Pay 2 lần');
 * // [{ id: 'a', kind: 'text', at: 1, text: 'Chạm Pay 2 lần' }]
 * ```
 *
 * **Unit test:** `ReportSheet.test.tsx` › `trang sửa các bước` — case sửa chữ ⇒ `kind: text`.
 */
export const editStep = (
  steps: readonly ReportStep[],
  index: number,
  text: string,
): readonly ReportStep[] =>
  steps.map((s, i) => (i === index ? { id: s.id, kind: 'text', at: s.at, text } : s));

export interface StepsEditorProps {
  steps: readonly ReportStep[];
  /** Dòng ghi chú — xem {@link stepsNote}. */
  note: string;
  /** Bộ chuỗi giao diện: bước có cấu trúc dựng thành câu theo ngôn ngữ của app (spec 11.2). */
  strings: DevToolsStrings;
  /** `id` của bước vừa thêm — ô của nó được focus. */
  focusId?: string;
  onChange: (steps: readonly ReportStep[]) => void;
  onAdd: () => void;
}

/**
 * **Chức năng:** trang sửa các bước tái hiện, mở từ thẻ "N bước tự ghi · Sửa ›" của form, nằm
 * **trong** sheet báo bug (không mở sheet thứ hai). Mỗi bước là một ô chữ (câu dựng theo ngôn ngữ
 * giao diện) kèm ▲ · ▼ · xoá; cuối danh sách có "+ Thêm bước".
 *
 * - Đổi thứ tự bằng nút ▲▼, **không** kéo thả (spec 4.3.3: entry `plain` không có gesture-handler,
 *   kéo trong danh sách cuộn dọc dễ tranh cử chỉ). ▲ của bước đầu và ▼ của bước cuối bị khoá.
 * - Sửa chữ ⇒ {@link editStep} (bước thành `text`). Bước mới là `text` rỗng, ô của nó tự focus.
 * - Ô nhập là `TextInput` của bộ sheet (gorhom: tự đăng ký để sheet né bàn phím).
 *
 * **Input:** {@link StepsEditorProps}. **Output:** khối nội dung (vùng cuộn do `ReportSheet` lo).
 *
 * @example
 * ```tsx
 * <StepsEditor steps={draft.steps} note={stepsNote(draft, t)} strings={strings}
 *   onChange={(steps) => controller.update({ steps })} onAdd={addStep} />
 * // Ca biên: steps rỗng ⇒ câu "Chưa có bước nào…" + nút "+ Thêm bước".
 * ```
 *
 * **Unit test:** `ReportSheet.test.tsx` › `trang sửa các bước` — 10 case (×2 bộ sheet): ▲/▼ và nút
 * khoá ở biên · xoá · sửa chữ ⇒ `text` · thêm bước rỗng có focus · 4 dòng ghi chú · Back · nút ‹.
 */
export const StepsEditor = ({
  steps,
  note,
  strings,
  focusId,
  onChange,
  onAdd,
}: StepsEditorProps) => {
  const t = useDevToolsT();
  const theme = useTheme();
  const styles = useStyles(stylesOf);
  const { TextInput } = useSheetKit();
  const last = steps.length - 1;

  return (
    <View style={styles.root}>
      <Text testID="devtools-report-steps-note" variant="captionS_Regular" tone="secondary">
        {note}
      </Text>
      {steps.length === 0 ? (
        <Text variant="captionS_Regular" tone="secondary">
          {t('report.editor.empty')}
        </Text>
      ) : null}
      {steps.map((step, i) => {
        const n = i + 1;
        return (
          <View key={step.id} style={styles.row}>
            <Text variant="captionS_Medium" tone="secondary" style={styles.index}>
              {`${n}.`}
            </Text>
            <TextInput
              testID={`devtools-report-step-${i}`}
              value={renderStep(step, strings)}
              onChangeText={(text) => onChange(editStep(steps, i, text))}
              placeholder={t('report.editor.placeholder')}
              placeholderTextColor={theme.colors.text.tertiary}
              selectionColor={theme.colors.text.brand}
              keyboardAppearance={theme.mode}
              accessibilityLabel={t('report.editor.step', { n })}
              autoFocus={step.id === focusId}
              multiline
              style={styles.input}
            />
            <View style={styles.actions}>
              <Button
                testID={`devtools-report-step-up-${i}`}
                label="▲"
                accessibilityLabel={t('report.editor.moveUp', { n })}
                variant="tertiary"
                size="sm"
                disabled={i === 0}
                onPress={() => onChange(moveStep(steps, i, -1))}
              />
              <Button
                testID={`devtools-report-step-down-${i}`}
                label="▼"
                accessibilityLabel={t('report.editor.moveDown', { n })}
                variant="tertiary"
                size="sm"
                disabled={i === last}
                onPress={() => onChange(moveStep(steps, i, 1))}
              />
              <Button
                testID={`devtools-report-step-delete-${i}`}
                label={t('report.editor.remove', { n })}
                iconOnly
                variant="tertiary"
                size="sm"
                onPress={() => onChange(steps.filter((_s, k) => k !== i))}
                leftIcon={({ size, color }) => <Icon name="delete" size={size} color={color} />}
              />
            </View>
          </View>
        );
      })}
      <Button
        testID="devtools-report-step-add"
        label={t('report.editor.add')}
        variant="secondary"
        size="sm"
        onPress={onAdd}
      />
    </View>
  );
};
