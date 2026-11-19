import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useDevToolsT } from '../../i18n/use-devtools-t';
import { Button } from '../../ui/Button';
import { Text } from '../../ui/Text';
import type { DevToolsTheme } from '../../ui/theme';
import { useStyles } from '../../ui/use-styles';
import type { ConnectionStore } from '../connections/connection-store';

const stylesOf = (t: DevToolsTheme) => ({
  box: {
    gap: t.spacing.xs,
    padding: t.spacing.sm,
    borderRadius: t.radius.md,
    backgroundColor: t.colors.background.dangerSubtle,
  },
});

/**
 * Vì sao phải đặt lại: danh sách hỏng (`ConnectionListCorruptError`, R18), hoặc kho ném khi đọc ở
 * hai lần lưu/xoá liền nhau (`ConnectionStoreReadError`, R39).
 */
export type ResetReason = 'corrupt' | 'unreadable';

/**
 * Số lần lưu/xoá **liền nhau** hỏng vì kho ném khi đọc thì mới đưa "Đặt lại kết nối" (R39). Một lần có
 * thể chỉ là thoáng qua (khoá máy, huỷ sinh trắc) — đặt lại khi đó là xoá oan mọi kết nối.
 */
export const READ_FAILURES_BEFORE_RESET = 2;

export interface ResetConnectionsNoticeProps {
  connections: ConnectionStore;
  /** Gọi sau khi `resetAll` xong — chỗ chứa tải lại danh sách / cho Lưu lại. */
  onReset: () => void | Promise<void>;
  /** Chọn câu giải thích. Mặc định `'corrupt'`. */
  reason?: ResetReason;
  testID?: string;
}

/**
 * **Chức năng:** khối báo "không đọc được kết nối đã lưu" kèm nút **Đặt lại kết nối** (R18, R39).
 * Câu theo `reason`: danh sách hỏng, hoặc kho đọc hỏng nhiều lần liền (nói rõ mọi kết nối **và bí
 * mật** sẽ bị xoá). Bấm ⇒ `connections.resetAll()` rồi `onReset()`; đặt lại lỗi ⇒ câu lỗi, nút vẫn
 * còn để thử lại. Không bao giờ tự đặt lại — chỉ khi QA bấm. Dùng chung cho trang Kết nối và form.
 *
 * Cờ "còn gắn" đặt lại `true` **trong** effect: StrictMode (dev) chạy gắn → dọn → gắn lại, nên chỉ
 * khởi tạo ref bằng `true` thì sau lượt dọn đầu nó nằm `false` mãi và nút kẹt ở trạng thái bận.
 *
 * **Input:** {@link ResetConnectionsNoticeProps}. **Output:** khối báo + nút.
 *
 * @example
 * ```tsx
 * {corrupt ? <ResetConnectionsNotice connections={store} onReset={reload} /> : null}
 * <ResetConnectionsNotice reason="unreadable" connections={store} onReset={clearError} />
 * // Ca biên: resetAll ném ⇒ "Không đặt lại được kết nối. Thử lại.", nút còn nguyên.
 * ```
 *
 * **Unit test:** `ConnectionsPage.test.tsx` (đặt lại thành công rồi tải lại · đặt lại lỗi · đọc kho
 * hỏng hai lần · StrictMode: thôi bận sau khi hỏng rồi thành công, cả gắn trực tiếp lẫn trong trang)
 * và `ConnectionEditor.test.tsx` (danh sách hỏng → đặt lại → Lưu lại · đọc kho hỏng hai lần) × 2 kit.
 */
export const ResetConnectionsNotice = ({
  connections,
  onReset,
  reason = 'corrupt',
  testID,
}: ResetConnectionsNoticeProps) => {
  const styles = useStyles(stylesOf);
  const t = useDevToolsT();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const reset = useCallback(async () => {
    setBusy(true);
    setFailed(false);
    try {
      await connections.resetAll();
    } catch {
      if (alive.current) {
        setFailed(true);
        setBusy(false);
      }
      return;
    }
    if (alive.current) setBusy(false);
    await onReset();
  }, [connections, onReset]);

  return (
    <View testID={testID} style={styles.box}>
      <Text tone="danger">
        {t(reason === 'unreadable' ? 'connections.reset.unreadable' : 'connections.reset.notice')}
      </Text>
      {failed ? <Text tone="danger">{t('connections.reset.failed')}</Text> : null}
      <Button
        testID={testID ? `${testID}-reset` : undefined}
        label={t('connections.reset.action')}
        loading={busy}
        onPress={reset}
      />
    </View>
  );
};
