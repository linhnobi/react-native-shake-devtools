import { Pressable, Switch, View } from 'react-native';
import { useDevToolsT } from '../../i18n/use-devtools-t';
import { Button } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { useSheetKit } from '../../ui/sheet-kit';
import { Text } from '../../ui/Text';
import type { DevToolsTheme } from '../../ui/theme';
import { useStyles, useTheme } from '../../ui/use-styles';
import type { ConnectorField, ConnectorOption } from '../connectors/types';

/** Giá trị một ô của form (không bí mật): chữ, bật/tắt, hoặc danh sách id đã chọn. */
export type ConnectionFieldValue = string | boolean | readonly string[];

/** Style của ô; `input` dùng chung với ô "Tên kết nối" của `ConnectionEditor`. */
export const connectionFieldStylesOf = (t: DevToolsTheme) => ({
  field: { gap: t.spacing['2xs'], paddingHorizontal: t.spacing.md },
  input: {
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
  secretRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: t.spacing.xs },
  grow: { flex: 1 },
  chips: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: t.spacing.xs },
});

export interface ConnectionFieldProps {
  field: ConnectorField;
  /** Giá trị hiện tại. Ô bí mật: chữ QA **đang gõ** (rỗng khi chỉ có bản đã lưu). */
  value: ConnectionFieldValue | undefined;
  /** Lựa chọn của ô `select`/`multiselect`; `undefined` ⇒ hiện `optionsHint`. */
  options?: readonly ConnectorOption[];
  /** Câu thay cho lựa chọn khi chưa có (chờ Thử kết nối, chờ ô cha, đang tải…). */
  optionsHint?: string;
  /** Câu lỗi nằm ngay dưới ô (lỗi `validation` của đúng ô này). */
  error?: string;
  /** Ô bí mật đã lưu: dạng che `••••xxxx` — không bao giờ là bản gốc. */
  savedMasked?: string;
  /** Hiện nút **Dán** của ô bí mật (máy đọc được bộ nhớ tạm, ruling R9). */
  canPaste?: boolean;
  onChange: (value: ConnectionFieldValue) => void;
  onPaste?: () => void;
}

/**
 * **Chức năng:** vẽ một ô của form kết nối theo `field.kind` (spec 5.4: các ô do loại kết nối tự
 * khai). `testID` gốc là `connection-field-<id>`:
 *
 * | kind | vẽ |
 * |---|---|
 * | `text` · `url` · `number` · `date` · `textarea` | ô nhập (`SheetKit.TextInput`) mang `testID` gốc |
 * | `secret` | ô nhập che (`secureTextEntry`) + nút Dán (`-paste`) + dòng `Đã lưu ••••xxxx` (`-saved`) |
 * | `select` · `multiselect` | nhóm chip mang `testID` gốc, mỗi chip `-<optionId>`; chưa có lựa chọn ⇒ `optionsHint` |
 * | `toggle` | `Switch` mang `testID` gốc |
 * | có `unsupportedType` | **không có ô nhập**: chỉ câu `help` (`-unsupported`, spec 11.3) |
 *
 * Nhãn, gợi ý (`help`) và lỗi (`-error`) nằm quanh ô. Mọi màu lấy từ theme.
 *
 * **Input:** {@link ConnectionFieldProps}. **Output:** khối ô.
 *
 * @example
 * ```tsx
 * <ConnectionField field={{ id: 'token', label: 'API token', kind: 'secret' }} value=""
 *   savedMasked="••••1a2b" canPaste onChange={setToken} onPaste={paste} />
 * // Ca biên: field.unsupportedType = 'gh-sprint' ⇒ chỉ câu báo, không ô nhập.
 * ```
 *
 * **Unit test:** không có file riêng — `ConnectionEditor.test.tsx` kiểm qua form (ô che, Dán, chip,
 * gợi ý chờ, trường chưa hỗ trợ, lỗi dưới ô, màu sáng/tối) × 2 kit.
 */
export const ConnectionField = ({
  field,
  value,
  options,
  optionsHint,
  error,
  savedMasked,
  canPaste = false,
  onChange,
  onPaste,
}: ConnectionFieldProps) => {
  const t = useDevToolsT();
  const styles = useStyles(connectionFieldStylesOf);
  const base = `connection-field-${field.id}`;
  const unsupported = field.unsupportedType !== undefined;

  return (
    <View style={styles.field}>
      <Text variant="bodyM_Medium">{field.label}</Text>
      {unsupported ? (
        <Text testID={`${base}-unsupported`} tone="warning">
          {field.help ??
            t('connections.editor.unsupportedField', {
              name: field.label,
              type: field.unsupportedType,
            })}
        </Text>
      ) : (
        <>
          <FieldInput
            field={field}
            testID={base}
            value={value}
            options={options}
            optionsHint={optionsHint}
            canPaste={canPaste}
            onChange={onChange}
            onPaste={onPaste}
          />
          {field.help ? <Text tone="tertiary">{field.help}</Text> : null}
        </>
      )}
      {savedMasked !== undefined ? (
        <Text testID={`${base}-saved`} tone="tertiary">
          {t('connections.editor.savedSecret', { masked: savedMasked })}
        </Text>
      ) : null}
      {error !== undefined ? (
        <Text testID={`${base}-error`} tone="danger">
          {error}
        </Text>
      ) : null}
    </View>
  );
};

const KEYBOARD: Partial<Record<ConnectorField['kind'], 'url' | 'numeric'>> = {
  url: 'url',
  number: 'numeric',
};

const FieldInput = ({
  field,
  testID,
  value,
  options,
  optionsHint,
  canPaste,
  onChange,
  onPaste,
}: Omit<ConnectionFieldProps, 'error' | 'savedMasked'> & { testID: string }) => {
  const t = useDevToolsT();
  const theme = useTheme();
  const styles = useStyles(connectionFieldStylesOf);
  const { TextInput } = useSheetKit();

  if (field.kind === 'select' || field.kind === 'multiselect') {
    const multi = field.kind === 'multiselect';
    const chosen: readonly string[] = Array.isArray(value)
      ? value
      : typeof value === 'string'
        ? [value]
        : [];
    return (
      <View testID={testID} style={styles.chips}>
        {options === undefined || options.length === 0 ? (
          <Text tone="tertiary">
            {options === undefined ? optionsHint : t('connections.editor.optionsEmpty')}
          </Text>
        ) : (
          options.map((option) => {
            const selected = chosen.includes(option.id);
            const next = (): string | readonly string[] => {
              if (!multi) return option.id;
              return selected ? chosen.filter((id) => id !== option.id) : [...chosen, option.id];
            };
            return (
              <Pressable
                key={option.id}
                testID={`${testID}-${option.id}`}
                accessibilityRole="button"
                accessibilityLabel={option.label}
                accessibilityState={{ selected }}
                onPress={() => onChange(next())}
              >
                <Chip label={option.label} state={selected ? 'active' : 'default'} />
              </Pressable>
            );
          })
        )}
      </View>
    );
  }

  if (field.kind === 'toggle') {
    return (
      <Switch
        testID={testID}
        accessibilityLabel={field.label}
        value={value === true}
        onValueChange={onChange}
        trackColor={{ false: theme.colors.border.strong, true: theme.colors.background.brand }}
        thumbColor={theme.colors.background.surface}
      />
    );
  }

  const secret = field.kind === 'secret';
  const input = (
    <TextInput
      testID={testID}
      value={typeof value === 'string' ? value : ''}
      onChangeText={onChange}
      placeholder={field.placeholder ?? (field.kind === 'date' ? 'YYYY-MM-DD' : undefined)}
      placeholderTextColor={theme.colors.text.tertiary}
      accessibilityLabel={field.label}
      keyboardAppearance={theme.mode}
      selectionColor={theme.colors.text.brand}
      keyboardType={KEYBOARD[field.kind]}
      multiline={field.kind === 'textarea'}
      secureTextEntry={secret}
      autoCapitalize="none"
      autoCorrect={false}
      spellCheck={false}
      autoComplete="off"
      style={styles.input}
    />
  );
  if (!secret || !canPaste) return input;
  return (
    <View style={styles.secretRow}>
      <View style={styles.grow}>{input}</View>
      <Button
        testID={`${testID}-paste`}
        label={t('connections.editor.paste')}
        accessibilityLabel={t('connections.editor.pasteA11y', { label: field.label })}
        variant="secondary"
        size="sm"
        onPress={onPaste}
      />
    </View>
  );
};
