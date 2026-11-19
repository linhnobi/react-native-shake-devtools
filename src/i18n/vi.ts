/**
 * Chuỗi giao diện của **vỏ** panel gỡ lỗi (ngôn ngữ nguồn: tiếng Việt), và chỉ có thế.
 *
 * Nhãn từng hàng do **app** truyền vào (`DevToolsAction.label`, đã dịch ở namespace của app):
 * chuỗi của app không nằm trong bộ này nên lib không tra được, và cũng không nên tra —
 * mỗi app có bộ công cụ khác nhau.
 *
 * Đây là file NGÔN NGỮ NGUỒN: `DevToolsStrings` (`types.ts`) suy kiểu từ file này, và `en.ts` khai
 * `satisfies DevToolsStrings` nên thiếu key là lỗi typecheck.
 */
export const vi = {
  common: {
    /** Nhãn (tên a11y) của nút ✕ đóng sheet — nút chỉ có icon nên đây là tên duy nhất của nó. */
    close: 'Đóng',
  },

  /** Nhãn a11y của chính thành phần giao diện của lib (screen reader đọc). Không hiện trên màn. */
  a11y: {
    /** Nhãn vùng phủ sau sheet — bấm được (đóng sheet) nhưng không có chữ nhìn thấy. */
    closeSheet: 'Đóng',
    /** Nhãn thanh kéo của sheet. Nói cả **cách dùng** vì cử chỉ vuốt không tự hiện ra với screen reader. */
    sheetHandle: 'Vuốt xuống để đóng',
    /** Nhãn mặc định của sheet khi không có tiêu đề. */
    sheet: 'Hộp thoại',
    /** Tên a11y của ô tìm khi không có chữ gợi ý. */
    searchField: 'Ô tìm kiếm',
    /**
     * Nhãn nút xoá chữ trong ô tìm.
     *
     * `{{label}}` — **chữ gợi ý của ô** (hoặc `a11y.searchField`), để screen reader đọc "Xoá nội dung
     *   Tìm URL, mã lỗi, nội dung…". Ví dụ: `Ô tìm kiếm`.
     */
    clearInput: 'Xoá nội dung {{label}}',
  },

  panel: {
    /** Tiêu đề sheet, và cũng là nhãn dòng thêm vào dev menu của RN khi chạy từ Metro. */
    title: 'Công cụ gỡ lỗi',
    /**
     * Hàng tắt cảm biến lắc tạm thời — lối thoát cho QA đang di chuyển mà panel cứ nhảy ra.
     *
     * `{{minutes}}` — **số phút** tắt, lấy từ `DevToolsConfig.snoozeMinutes` (mặc định `30`).
     *   Ví dụ giá trị thật: `30`, `5`, `60`. Là số nguyên dương, do app khai.
     *
     * 📌 Tên biến là `minutes` chứ không phải `count`: `t()` của lib không chọn dạng số nhiều, nên
     * tên nói rõ đơn vị dễ đọc hơn — tiếng Việt không đổi theo số, và bản tiếng Anh dùng "minutes"
     * cho mọi giá trị.
     */
    snooze: 'Tắt lắc trong {{minutes}} phút',
    /** Hàng **có sẵn của lib** mở màn nhật ký — không phải hàng do app cấp. */
    log: 'Nhật ký',
    /**
     * Dòng phụ dưới hàng Nhật ký — tổng số dòng đang giữ và số lỗi trong đó. Huy hiệu đỏ bên phải
     * chỉ đếm lỗi; tổng số dòng nằm ở đây để không ai đọc nhầm tổng thành số lỗi.
     *
     * `{{total}}` — **số** dòng đang giữ (console + mạng, không tính mốc). Ví dụ: `214`.
     * `{{errors}}` — **số** dòng lỗi trong đó. Ví dụ: `12`, `0`.
     */
    logHint: '{{total}} dòng · {{errors}} lỗi',
    /** Hàng mở màn xem **phiên trước** (lần mở app trước, đọc từ đĩa). */
    previous: 'Phiên trước',
    /**
     * Dòng phụ của hàng Phiên trước.
     *
     * `{{time}}` — ngày giờ lần ghi cuối của phiên đó, dạng `2026-09-24 13:58:02 +07:00`.
     * `{{total}}` — **số** dòng đã lưu. Ví dụ: `48`.
     * `{{errors}}` — **số** lỗi trong đó. Ví dụ: `3`.
     */
    previousHint: '{{time}} · {{total}} dòng · {{errors}} lỗi',
    /** Tiêu đề dải đỏ đầu panel khi phiên trước chết vì một lỗi JS nghiêm trọng (app crash). */
    crashTitle: 'Lần trước app bị crash',
    /**
     * Dòng dưới tiêu đề dải crash — chạm để xem nhật ký đã kịp lưu.
     *
     * `{{time}}` — ngày giờ lần ghi cuối trước khi app chết, dạng `2026-09-24 13:58:02 +07:00`.
     * `{{errors}}` — **số** lỗi đã lưu. Ví dụ: `3`.
     */
    crashHint: 'Lúc {{time}} · {{errors}} lỗi đã được giữ lại — chạm để xem',
    /** Hàng chép khối "bản build · máy · user (đã che) · giờ mở app" ra bộ nhớ tạm, để dán vào ticket. */
    copyInfo: 'Chép thông tin thiết bị',
    /** Nhãn hàng trên ~1,5 giây sau khi chép xong. */
    infoCopied: 'Đã chép thông tin thiết bị',
    /**
     * Hàng (ngay dưới Nhật ký) chép khối **Markdown đã che** của phiên đang chạy — lỗi, request lỗi/chậm,
     * các bước, console — để dán vào agent lập trình (Claude Code, Cursor, Copilot). "AI" giữ nguyên.
     */
    copyAi: 'Chép cho AI',
    /** Dòng phụ của hàng Chép cho AI — nói khối chép gồm gì và dùng vào đâu. */
    copyAiHint: 'Lỗi, request và các bước dạng Markdown, để dán vào agent lập trình',
    /** Nhãn hàng Chép cho AI ~1,5 giây sau khi chép xong. */
    aiCopied: 'Đã chép cho AI',
    /** Nhãn hàng Chép cho AI ~1,5 giây khi không chép được (bộ nhớ tạm vắng và khay chia sẻ báo lỗi). */
    aiCopyFailed: 'Không chép được',
    /** Hàng **đầu tiên** của panel (chỉ có khi app bật báo bug) — mở form báo bug đã điền sẵn. */
    report: 'Báo bug',
    /**
     * Dòng phụ của hàng Báo bug khi QA đang có một bản nháp chưa gửi — bấm vào là gặp lại đúng bản
     * đó (ảnh và các bước của nháp không tự làm mới).
     */
    reportDraft: 'Có bản nháp',
    /** Đoạn đầu dòng phụ của hàng Báo bug: đã chụp được màn hình lúc lắc máy. */
    reportShot: 'Ảnh đã chụp',
    /** Đoạn đầu dòng phụ của hàng Báo bug: app chặn chụp màn đang mở (hàm chụp của app trả `null`). */
    reportShotBlocked: 'Màn này không cho chụp ảnh',
    /** Đoạn đầu dòng phụ của hàng Báo bug: hàm chụp của app báo lỗi hoặc quá lâu không xong. */
    reportShotFailed: 'Không chụp được ảnh',
    /**
     * Đoạn cuối dòng phụ của hàng Báo bug: số bước tái hiện tool tự ghi (chạm, đổi màn, lỗi…).
     *
     * `{{count}}` — **số** bước sẽ có trong form. Ví dụ: `4`, `0`.
     */
    reportSteps: '{{count}} bước tự ghi',
    /**
     * Đoạn thêm vào cuối dòng phụ hàng Báo bug: số bản báo hàng đợi đang tự lo (đang gửi / chờ gửi
     * lại). `{{count}}` — số bản, ≥ 1. Ví dụ: `2`.
     */
    reportWaiting: '{{count}} chờ gửi',
    /**
     * Đoạn thêm vào cuối dòng phụ hàng Báo bug: số bản báo QA phải ra tay (gửi thất bại · bị chặn ·
     * không chắc đã gửi). `{{count}}` — số bản, ≥ 1. Ví dụ: `1`.
     */
    reportAttention: '{{count}} cần xử lý',
  },

  /**
   * Màn xem nhật ký.
   *
   * ⚠️ Chỉ **khung** màn nằm ở đây. Nội dung từng dòng (`GET`, `404`, `WARN`, URL, thân JSON)
   * cố ý **không** đi qua i18n: đó là dữ liệu đã bắt, và chính khối chữ đó là thứ QA gửi cho
   * BE — nó phải đọc y nhau bất kể app đang chạy ngôn ngữ gì.
   */
  log: {
    title: 'Nhật ký',
    /** Hiện khi vòng đệm rỗng — gồm cả ca app chưa gọi `startCapture`. */
    empty: 'Chưa bắt được dòng nào',
    clear: 'Xoá',
    /**
     * Nút đẩy cả khối nhật ký ra ngoài app.
     *
     * "Chia sẻ" chứ không phải "Chép": lib không kéo gói clipboard, và app có thể chặn chụp
     * màn hình (FLAG_SECURE trên Android, chặn screenshot trên iOS) nên đây là đường duy nhất đưa
     * nội dung sang Zalo/ticket.
     */
    share: 'Chia sẻ',
    /** Nút lộ ra khi **vuốt một dòng sang phải** — chép đúng dòng đó, không phải cả nhật ký. */
    copy: 'Chép',
    /** Dấu xác nhận hiện ~1,5 giây trên chính dòng vừa chép. */
    copied: 'Đã chép',
    /**
     * Dòng chỉ đường đặt ngay trên danh sách, chỉ hiện khi có dòng để vuốt.
     *
     * Cần thiết vì cử chỉ này **không có dấu hiệu thị giác nào** trước khi tay chạm vào: nút
     * "Chép" nằm khuất ở mép trái và chỉ lộ ra sau khi đã vuốt. Không nói ra thì QA không có
     * cách nào đoán được là chép được từng dòng — họ sẽ dùng "Chia sẻ" cho cả khối.
     */
    swipeHint: 'Vuốt phải để chép · giữ lâu để xem thao tác',
    /**
     * Bản của `swipeHint` cho entry `./plain` — ở đó hàng không vuốt được, cú giữ lâu là lối duy
     * nhất để chép (dải thao tác có nút Chép cURL / URL / response / dòng + Chia sẻ).
     */
    longPressHint: 'Giữ lâu một dòng để chép · chia sẻ',
    filterAll: 'Tất cả',
    /** Giữ nguyên chữ `Console` — thuật ngữ kỹ thuật, dịch ra sẽ khó tra hơn. */
    filterConsole: 'Console',
    filterNetwork: 'Mạng',
    /** Nhãn gợi ý của ô tìm — liệt kê đúng thứ ô khớp được (URL, status, nội dung, thân JSON). */
    searchPlaceholder: 'Tìm URL, mã lỗi, nội dung…',
    /**
     * Chip lọc **chỉ dòng lỗi** (console.error · HTTP ≥ 400 · lỗi mạng), kèm số đếm. Chữ "Chỉ"
     * để đọc ra là **bộ lọc** — "Lỗi · 12" đứng một mình trông như dòng báo "có 12 lỗi".
     *
     * `{{errors}}` — **số** dòng lỗi đang có trong nhật ký, số nguyên `>= 0`.
     *   Ví dụ giá trị thật: `0`, `12`, `300`.
     *
     * 📌 Tên biến là `errors` chứ không phải `count` — cùng lý do với `panel.snooze`.
     */
    filterError: 'Chỉ lỗi · {{errors}}',
    /**
     * Chip lọc **mọi dòng trừ dòng lỗi** — gồm cả `warn` và request đang chờ phản hồi. Gọi theo
     * việc nó làm ("ẩn lỗi") chứ không theo kết cục ("thành công"): dòng console không có "thành
     * công", và request đang chờ thì chưa thành công.
     */
    filterOk: 'Ẩn lỗi',
    /**
     * Dòng đếm trên danh sách — bao nhiêu dòng đang hiện sau khi lọc / tổng số đang giữ.
     *
     * `{{shown}}` — **số** dòng đang hiện sau khi áp bộ lọc + ô tìm. Ví dụ: `12`.
     * `{{total}}` — **số** dòng đang giữ trong vòng đệm (tối đa bằng sức chứa, mặc định 300).
     *   Ví dụ: `300`.
     */
    shownOf: 'Hiện {{shown}}/{{total}} dòng',
    /**
     * Nút xuất **file** chứa toàn bộ dòng lỗi (không theo bộ lọc đang chọn) — gửi cho BE.
     * Khác "Chia sẻ" (khối text mọi dòng để dán vào chat).
     */
    exportErrors: 'Xuất lỗi',
    /** Dấu xác nhận ~2 giây sau khi khay chia sẻ/lưu file đóng lại bình thường. */
    exported: 'Đã xuất',
    /** Dấu ~2 giây khi ghi file hoặc mở khay chia sẻ thất bại. */
    exportFailed: 'Không xuất được',
    /**
     * Nút ở chân màn **phiên trước** (cạnh Xuất lỗi): chép khối Markdown đã che của phiên đó để dán vào
     * agent lập trình. Màn nhật ký sống không có nút này (chân đã kín chỗ) — hàng "Chép cho AI" của panel
     * lo phiên đang chạy.
     */
    copyAi: 'Chép cho AI',
    /** Nhãn nút Chép cho AI ~1,5 giây khi không chép được (bộ nhớ tạm vắng và khay chia sẻ báo lỗi). */
    copyFailed: 'Không chép được',
    /** Danh sách rỗng **vì bộ lọc/ô tìm**, trong khi nhật ký vẫn có dòng — khác `empty`. */
    noMatch: 'Không có dòng nào khớp bộ lọc',
    /** Nút dưới `noMatch` — xoá chữ tìm và đưa cả hai trục lọc về "tất cả". */
    resetFilters: 'Bỏ lọc',
    /**
     * Chip lọc **request chậm** (đã xong và mất từ ngưỡng trở lên), kèm ngưỡng và số đếm — ghi
     * ngưỡng lên chip để người thử khỏi đoán "chậm" là bao lâu.
     *
     * `{{seconds}}` — **số** giây của ngưỡng chậm, lấy từ `DEFAULT_SLOW_MS`. Ví dụ: `3`.
     * `{{slow}}` — **số** request chậm trong nhật ký. Ví dụ: `0`, `3`.
     *   Ra chữ: `Chậm ≥3s · 3`.
     */
    filterSlow: 'Chậm ≥{{seconds}}s · {{slow}}',
    /** Nhãn vàng cạnh thời lượng trên một dòng request chậm. */
    slow: 'Chậm',
    /** Nút thanh đáy — cho danh sách đứng yên để đọc; thu nhật ký vẫn chạy phía sau. */
    pause: 'Tạm dừng',
    /** Cùng nút đó khi đang tạm dừng. */
    resume: 'Tiếp tục',
    /** Nút thanh đáy — chèn một mốc "⚑ Đánh dấu #n" vào nhật ký, QA bấm ngay trước khi tái hiện lỗi. */
    mark: 'Đánh dấu',
    /**
     * Dải trên danh sách khi đang tạm dừng.
     *
     * `{{time}}` — giờ bấm Tạm dừng, dạng `14:27:55.120`.
     */
    pausedAt: 'Đã tạm dừng lúc {{time}}',
    /**
     * Phần sau của dải tạm dừng — có dòng mới đổ vào phía sau; chạm dải để xem.
     *
     * `{{fresh}}` — **số** dòng mới kể từ lúc tạm dừng. Ví dụ: `5`.
     */
    pausedFresh: '↑ {{fresh}} dòng mới — chạm để xem',
    /**
     * Mốc đổi màn trên dòng thời gian.
     *
     * `{{screen}}` — tên route kỹ thuật của màn, **không dịch**. Ví dụ: `UserList`, `OrderDetail`.
     */
    markerScreen: '→ Màn {{screen}}',
    /**
     * Mốc người thử tự đánh dấu.
     *
     * `{{n}}` — số thứ tự của mốc trong buổi thử (1, 2, 3…), không về 0 khi xoá nhật ký.
     */
    markerUser: '⚑ Đánh dấu #{{n}}',
    /** Gợi ý đọc cho trình đọc màn hình trên mỗi dòng — nói ra hai cử chỉ không nhìn thấy được. */
    rowA11yHint: 'Chạm để mở, giữ lâu để xem thao tác',
    /** Nút chép lệnh curl chạy được (có token thật) — dải giữ lâu và trang chi tiết. */
    copyCurl: 'Chép cURL',
    copyUrl: 'Chép URL',
    /** Chép thân phản hồi **đã che**, JSON dàn dòng — đúng thứ đang thấy trên màn. */
    copyResponse: 'Chép response',
    copyRequest: 'Chép request',
    copyHeaders: 'Chép header',
    /** Chép nguyên một dòng console. */
    copyLine: 'Chép dòng',
    /** Mở khay chia sẻ cho **một** dòng (đã che) — khác "Chia sẻ" ở header là cả nhật ký. */
    shareEntry: 'Chia sẻ dòng này',
    /** Nhãn a11y của nút mũi tên quay lại danh sách từ trang chi tiết. */
    back: 'Quay lại danh sách',
    /** Trạng thái của request chưa có phản hồi. */
    pending: 'đang chờ',
    /** Kết cục của request bị **app huỷ** (`abort()`, `AbortController`) — trung tính, không phải lỗi. */
    cancelled: 'Đã huỷ',
    tabOverview: 'Tổng quan',
    /** Giữ nguyên thuật ngữ HTTP ở năm tab — dịch ra khó đối chiếu với công cụ của BE. */
    tabHeaders: 'Headers',
    tabRequest: 'Request',
    tabResponse: 'Response',
    tabCurl: 'cURL',
    fieldUrl: 'URL',
    fieldMethod: 'Method',
    fieldStatus: 'Trạng thái',
    fieldDuration: 'Thời lượng',
    fieldTime: 'Thời điểm gửi',
    fieldScreen: 'Màn lúc gửi',
    /**
     * Thời lượng request.
     *
     * `{{ms}}` — **số** mili-giây. Ví dụ: `812`, `3214`.
     */
    durationMs: '{{ms}} ms',
    noHeaders: 'Request không có header nào',
    /** Câu dưới tab Headers — tầng thu hiện chỉ đọc header của request, chưa đọc header phản hồi. */
    responseHeadersNote: 'Header phản hồi chưa được ghi lại.',
    noBody: 'Không có thân',
    /**
     * Request/response **có** thân nhưng tầng thu không ghi lại — thay cho `noBody`, vốn sẽ là nói
     * dối. Một câu cho mỗi lý do (`BodySkip` của `capture/log-entry.ts`).
     */
    bodyNotCaptured: {
      binary: 'Không bắt được thân — dữ liệu nhị phân.',
      formData: 'Không bắt được thân — FormData (có thể kèm tệp).',
      tooLarge: 'Không bắt được thân — quá lớn để đọc (trên 1 MB).',
      unreadable: 'Không bắt được thân — không đọc được.',
    },
    /** Thân vượt hạn mức nên đã bị cắt lúc ghi — phần cuối không còn, JSON có thể không hợp lệ. */
    truncatedNote: 'Thân đã bị cắt bớt — phần cuối không còn.',
    /** Thân đang xem là bản **đầy đủ** từ kho riêng (không phải bản 4 KB của nhật ký). */
    fullBodyNote: 'Đang xem bản đầy đủ — chỉ giữ cho 20 request gần nhất và request lỗi.',
    /** Hai chip đổi cách xem thân JSON. */
    viewTree: 'Cây',
    viewText: 'Văn bản',
    /** Câu gợi ý thao tác trên cây JSON. */
    treeHint: 'Chạm để mở/gập · giữ để chép nhánh',
    /** Thân không parse được (bị cắt / không phải JSON) ⇒ chỉ còn dạng văn bản. */
    treeUnavailable: 'Không dựng được cây (thân bị cắt hoặc không phải JSON) — đang xem dạng văn bản.',
    /**
     * Tóm tắt thân là object, đứng đầu tab.
     *
     * `{{size}}` — kích thước thân, đã định dạng. Ví dụ: `12.4 KB`.
     * `{{count}}` — **số** khoá cấp 1. Ví dụ: `3`.
     * `{{keys}}` — tên các khoá cấp 1, ngăn bởi dấu phẩy. Ví dụ: `code, message, data`.
     */
    jsonObjectSummary: '{{size}} · {{count}} khoá: {{keys}}',
    /**
     * Tóm tắt thân là mảng, đứng đầu tab.
     *
     * `{{size}}` — kích thước thân, đã định dạng. Ví dụ: `12.4 KB`.
     * `{{count}}` — **số** phần tử. Ví dụ: `20`.
     */
    jsonArraySummary: '{{size}} · mảng {{count}} phần tử',
    /**
     * Nhãn của một nhánh object đang gập.
     *
     * `{{count}}` — **số** khoá bên trong. Ví dụ: `8`.
     */
    jsonObjectCount: '{{count}} khoá',
    /**
     * Nhãn của một nhánh mảng đang gập.
     *
     * `{{count}}` — **số** phần tử. Ví dụ: `20`.
     */
    jsonArrayCount: '{{count}} phần tử',
    /**
     * Nút hiện thêm phần tử của một mảng dài (hiện từng đợt).
     *
     * `{{count}}` — **số** phần tử còn ẩn. Ví dụ: `150`.
     */
    jsonShowMore: 'Xem thêm ({{count}})',
    /** Câu dưới tab cURL — bản trên màn đã che, nút "Chép cURL" lấy bản chạy được. */
    curlNote: 'Bản trên màn đã che token. Nút "Chép cURL" chép bản chạy được, có token thật.',
    /** Tiêu đề màn khi xem nhật ký đã lưu của lần mở app trước. */
    previousTitle: 'Phiên trước',
    /**
     * Dòng phụ của màn Phiên trước, khi phiên kết thúc bình thường (hoặc bị tắt).
     *
     * `{{time}}` — ngày giờ lần ghi cuối, dạng `2026-09-24 13:58:02 +07:00`.
     */
    previousSaved: 'Lần ghi cuối {{time}}',
    /**
     * Dòng phụ của màn Phiên trước, khi phiên chết vì lỗi JS nghiêm trọng.
     *
     * `{{time}}` — ngày giờ lần ghi cuối trước khi crash, dạng `2026-09-24 13:58:02 +07:00`.
     */
    previousFatal: 'Kết thúc vì crash lúc {{time}}',
  },
  /** Báo bug trong app: các bước tự ghi và gợi ý tiêu đề. */
  report: {
    /**
     * Câu của từng **bước tái hiện** (`renderStep`). Bước lưu dạng có cấu trúc (loại + nhãn) và
     * dựng thành câu lúc hiện lên form, nên mỗi loại có một khoá. Nhãn đã được che dữ liệu cá nhân
     * từ lúc ghi. Bước QA đã sửa chữ là bước `text` — gửi nguyên chữ, không đi qua các khoá này.
     */
    step: {
      /** Đổi màn. `{{label}}` — tên route. Ví dụ: `Giỏ hàng`. */
      screen: 'Mở màn {{label}}',
      /** Chạm một phần tử có nhãn. `{{label}}` — nhãn đã che. Ví dụ: `Thanh toán`. */
      tap: 'Chạm "{{label}}"',
      /** Chạm một phần tử không lấy được nhãn. */
      tapNoLabel: 'Chạm (nút không nhãn)',
      /** Giữ lâu (≥ 500 ms) một phần tử có nhãn. `{{label}}` — nhãn đã che. */
      longPress: 'Giữ lâu "{{label}}"',
      /** Giữ lâu một phần tử không lấy được nhãn. */
      longPressNoLabel: 'Giữ lâu (nút không nhãn)',
      /** Vào một ô nhập — **không bao giờ có giá trị gõ**. `{{label}}` — nhãn ô. Ví dụ: `Email`. */
      input: 'Nhập vào ô "{{label}}"',
      /** Vào một ô nhập không lấy được nhãn. */
      inputNoLabel: 'Nhập vào một ô (không nhãn)',
      /** Nút Back của Android. */
      back: 'Bấm Back',
      /** App xuống nền. */
      background: 'App xuống nền',
      /** App lên lại từ nền. */
      foreground: 'App lên lại',
      /** Một lỗi xảy ra giữa các thao tác. `{{label}}` — tóm tắt lỗi. Ví dụ: `POST /orders → 500`. */
      error: '⚠ {{label}}',
    },
    /** Chữ máy điền sẵn vào ô "Thực tế" (`suggestReport`, `suggestFromCrash`). */
    suggest: {
      /** Có lỗi trong cửa sổ. `{{summary}}` — tóm tắt lỗi. Ví dụ: `POST /orders → 500`. */
      actual: 'Gặp lỗi: {{summary}}',
      /** App chết vì lỗi JS fatal ở phiên trước. `{{summary}}` — tóm tắt lỗi. */
      actualCrash: 'Ứng dụng bị crash: {{summary}}',
    },
    /**
     * Chữ cố định của **ticket** (Webhook, Slack, Lark, Jira dùng chung), dựng theo ngôn ngữ của
     * kết nối chứ không theo ngôn ngữ app (spec 11.2). Bước QA tự sửa chữ không đi qua đây.
     */
    ticket: {
      /** Tiêu đề mục các bước tái hiện. */
      steps: 'Các bước',
      /** Tiêu đề mục kết quả thực tế. */
      actual: 'Kết quả thực tế',
      /** Tiêu đề mục kết quả mong đợi. */
      expected: 'Kết quả mong đợi',
      /** Tiêu đề mục thông tin máy/bản build. */
      environment: 'Môi trường',
      /** Tiêu đề mục ngữ cảnh do app cấp (`bugReport.appContext`): user, cờ tính năng, state… */
      context: 'Ngữ cảnh app',
      /**
       * Dòng cuối mục ngữ cảnh app khi tóm tắt bỏ bớt khoá cấp đầu (bản đủ ở `context.json`).
       * `{{count}}` — số khoá bị bỏ.
       */
      contextMore: '…và {{count}} khoá khác',
      /** Câu ghi chú khi ticket có file đính kèm mà đích không nhận file (hoặc nhận một phần). */
      attachmentsNote: 'File đính kèm không gửi được qua kênh này.',
      /** Câu ghi chú khi nội dung bị cắt cho vừa giới hạn của đích. */
      truncatedNote: '(Nội dung đã bị cắt bớt.)',
      /**
       * Nhãn các dòng thông tin máy trong mục Môi trường của ticket (spec 11.2 — theo ngôn ngữ của
       * kết nối). `errors.txt` vẫn giữ nhãn tiếng Anh trung lập.
       */
      info: {
        /** Phiên bản app. */
        app: 'Ứng dụng',
        /** Môi trường build (`UAT`, `Staging`…). */
        env: 'Môi trường',
        /** Tên máy. */
        device: 'Thiết bị',
        /** Hệ điều hành và phiên bản. */
        os: 'Hệ điều hành',
        /** Người dùng đang đăng nhập (đã che). */
        user: 'Người dùng',
        /** Lúc phiên app bắt đầu. */
        session: 'Phiên',
      },
    },
    /** Vỏ sheet báo bug: tiêu đề và các nút ở header, dùng chung cho mọi trang của sheet. */
    sheet: {
      /** Tiêu đề sheet (trang form và trang kết quả). */
      title: 'Báo bug',
      /** Nhãn (tên a11y) nút ‹ quay về form từ trang con. */
      back: 'Quay lại',
      /** Nút huỷ bản nháp ở header của form. Bấm lần đầu chỉ hỏi lại. */
      discard: 'Huỷ nháp',
      /** Nút huỷ nháp sau lần bấm đầu — bấm lần nữa mới huỷ thật. */
      discardConfirm: 'Huỷ thật?',
      /** Kết quả chia sẻ không mang được ảnh (app không cấp `shareFiles`), spec 5.7. */
      imageDropped: 'Ảnh không chia sẻ được, app chưa hỗ trợ',
      /** Đường chia sẻ của app báo lỗi (khay chia sẻ, ghi file…). Bản nháp vẫn còn nguyên. */
      shareFailed: 'Không chia sẻ được',
    },
    /** Form báo bug (bố cục A+, spec 4.3). */
    form: {
      /** Nút chụp lại ảnh: đóng sheet, chụp màn của app, mở lại form. */
      retake: 'Chụp lại',
      /** Tên a11y của ảnh thu nhỏ. */
      shotAlt: 'Ảnh màn hình sẽ đính kèm',
      /** Chỗ ảnh khi app chặn chụp màn này (hàm chụp trả `null`). */
      shotBlocked: 'Màn này không cho chụp ảnh',
      /** Chỗ ảnh khi hàm chụp của app ném lỗi hoặc quá hạn. */
      shotFailed: 'Không chụp được ảnh',
      /** Nhãn ô tiêu đề. */
      title: 'Tiêu đề',
      /** Dòng nhắc dưới ô tiêu đề khi tiêu đề trống — nút Gửi khoá tới khi có tiêu đề. */
      titleRequired: 'Cần có tiêu đề để gửi',
      /** Dấu cạnh nhãn ô khi chữ trong ô do máy điền sẵn (QA chưa sửa). */
      prefilled: 'Máy điền sẵn',
      /** Thẻ thu gọn các bước tự ghi, bấm để mở trang sửa. `{{count}}` — số bước. */
      stepsCard: '{{count}} bước tự ghi · Sửa ›',
      /** Nhãn ô kết quả thực tế. */
      actual: 'Thực tế',
      /** Nhãn ô kết quả mong đợi. */
      expected: 'Mong đợi',
      /** Chữ gợi ý của ô mong đợi. */
      expectedPlaceholder: 'Không bắt buộc',
      /** Nhãn nhóm chip đính kèm. */
      attach: 'Đính kèm',
      /** Chip ảnh màn hình. */
      chipScreenshot: 'Ảnh',
      /** Chip log lỗi (`errors.txt` + `timeline.json`). `{{count}}` — số dòng lỗi của bug này. */
      chipErrors: 'Log lỗi ({{count}})',
      /** Chip thông tin máy. */
      chipDevice: 'Thông tin máy',
      /**
       * Chip ngữ cảnh do app cấp (`bugReport.appContext`): mục "Ngữ cảnh app" trong ticket +
       * `context.json`. Chỉ có khi app cấp hàm, không có ở nháp sau crash.
       */
      chipContext: 'Ngữ cảnh app',
      /** Chip ngữ cảnh khi hàm của app ném, quá 1,5 s, hoặc trả thứ không phải object — chip khoá. */
      chipContextFailed: 'Ngữ cảnh app: không lấy được',
      /** Chip đính kèm phiên trước — chỉ có khi phiên trước chết vì lỗi JS fatal. */
      chipPrevious: 'Phiên trước (crash)',
      /** Lý do chip ảnh/file bị khoá: kết nối mức nhẹ (webhook Slack/Lark) chỉ gửi được chữ. */
      attachUnsupported:
        'Kết nối này chỉ gửi chữ nên không kèm được ảnh và file. Gửi xong có nút chia sẻ chúng.',
      /** Nút gửi ở chân sheet. `{{name}}` — tên kết nối. Ví dụ: `Jira · DEMO`. */
      sendTo: 'Gửi tới {{name}}',
      /** Nhãn nút gửi lúc hàng đợi hoặc danh sách kết nối chưa đọc xong. */
      sendPreparing: 'Đang chuẩn bị…',
      /** Tên a11y của nút ▾ cạnh nút gửi — mở danh sách kết nối để đổi. */
      pickConnection: 'Đổi kết nối',
      /** Nút ở chân khi chưa có kết nối nào (hoặc app chưa cấp kho bảo mật). */
      addConnection: 'Thêm kết nối',
      /** Nút chia sẻ bản báo khi chưa có kết nối. */
      share: 'Chia sẻ',
      /** Gửi không bắt đầu được (lỗi ngoài hàng đợi). */
      sendFailed: 'Chưa gửi được, thử lại.',
    },
    /** Trang sửa các bước (trang trong sheet báo bug). */
    editor: {
      /** Tiêu đề trang. */
      title: 'Các bước',
      /**
       * Dòng ghi chú: các bước tính từ mốc ⚑ cuối. `{{label}}` — số của mốc, `{{time}}` — giờ:phút.
       * Ví dụ: `2`, `10:42`.
       */
      noteMark: 'Ghi từ mốc ⚑ #{{label}} lúc {{time}}',
      /** Dòng ghi chú: các bước tính từ lần gửi bug trước. `{{time}}` — giờ:phút. */
      noteSent: 'Ghi từ lần gửi trước lúc {{time}}',
      /** Dòng ghi chú: các bước tính từ lúc mở app. */
      noteSession: 'Ghi từ lúc mở app',
      /** Dòng ghi chú của nháp sau crash: các bước lấy từ phiên trước. */
      noteCrash: 'Các bước của phiên trước, trước khi app crash',
      /** Tên a11y ô chữ của một bước. `{{n}}` — số thứ tự bước (từ 1). */
      step: 'Bước {{n}}',
      /** Tên a11y nút ▲. `{{n}}` — số thứ tự bước (từ 1). */
      moveUp: 'Đưa bước {{n}} lên',
      /** Tên a11y nút ▼. `{{n}}` — số thứ tự bước (từ 1). */
      moveDown: 'Đưa bước {{n}} xuống',
      /** Tên a11y nút xoá bước. `{{n}}` — số thứ tự bước (từ 1). */
      remove: 'Xoá bước {{n}}',
      /** Nút thêm một bước chữ tự do ở cuối. */
      add: '+ Thêm bước',
      /** Chữ gợi ý của ô bước mới. */
      placeholder: 'Mô tả bước này',
      /** Chưa có bước nào. */
      empty: 'Chưa có bước nào. Thêm bước để người sửa tái hiện được lỗi.',
    },
    /** Trang chọn kết nối để gửi (nút ▾). */
    picker: {
      /** Tiêu đề trang. */
      title: 'Gửi tới',
      /** Dòng phụ của kết nối mức nhẹ. `{{type}}` — tên loại kết nối. Ví dụ: `Slack`. */
      light: '{{type}} · chỉ gửi chữ',
      /** Hàng mở màn quản lý kết nối. */
      manage: 'Quản lý kết nối',
    },
    /** Trang kết quả sau khi bấm Gửi (spec 4.4, 4.5, 5.6). */
    status: {
      /** Đang gửi (vd sau khi bấm Gửi lại). */
      sending: 'Đang gửi…',
      /** Đã tạo ticket. `{{key}}` — mã ticket. Ví dụ: `DEMO-482`. */
      sentKey: 'Đã tạo {{key}}',
      /** Đã gửi nhưng đích không trả mã ticket (Slack, Lark, webhook). */
      sent: 'Đã gửi',
      /** Nút mở link ticket. */
      open: 'Mở',
      /** Nút chép link ticket. */
      copyLink: 'Chép link',
      /** Dấu đã chép link. */
      copied: 'Đã chép',
      /** Nút bắt đầu bản báo mới (chụp lại màn của app). */
      another: 'Báo bug khác',
      /** File chưa gửi được (vd ảnh trong cache đã bị hệ điều hành xoá). `{{files}}` — tên file. */
      skipped: 'File chưa gửi được: {{files}}',
      /** Nút chia sẻ ảnh và log sau khi gửi qua kết nối mức nhẹ (spec 5.4). */
      shareLight: 'Chia sẻ ảnh và log',
      /** Mất mạng: bản báo nằm trong hàng đợi. */
      pending: 'Đã xếp hàng, sẽ tự gửi lại',
      /** Nút chia sẻ khi bản báo còn trong hàng đợi. */
      shareInstead: 'Chia sẻ thay vì gửi',
      /**
       * Request có thể đã tới đích (timeout sau khi gửi). `{{target}}` — tên loại kết nối. Ví dụ:
       * `Jira`.
       */
      uncertain: 'Không chắc đã gửi, kiểm tra ở {{target}} trước khi gửi lại',
      /** Nút gửi lại thủ công. */
      retry: 'Gửi lại',
      /** Token hết hạn hoặc sai (`auth`). `{{target}}` — tên loại kết nối. */
      auth: 'Token {{target}} hết hạn, nhập lại',
      /** Không đủ quyền (`permission`). `{{target}}` — tên loại kết nối. */
      permission: 'Không đủ quyền gửi tới {{target}}',
      /** Đích từ chối nội dung (`validation`). `{{target}}` — tên loại kết nối. */
      validation: '{{target}} không nhận nội dung này',
      /** Kết nối đã bị xoá hoặc mất bí mật (gỡ app, khôi phục máy). */
      missing: 'Kết nối này không còn (đã bị xoá hoặc mất thông tin đăng nhập)',
      /** Tên đích khi không biết loại kết nối. */
      targetFallback: 'đích gửi',
      /** Nút mở màn kết nối để nhập lại token / chọn kết nối khác. */
      openConnections: 'Mở màn kết nối',
      /** Nút về form để sửa rồi gửi lại. */
      edit: 'Sửa bản báo',
      /** Câu cho biết bản nháp không mất. */
      draftKept: 'Bản nháp vẫn được giữ.',
      /**
       * Bị chặn SAU khi ticket đã tạo (ruling R34): gửi lại cùng kết nối chỉ làm nốt phần thiếu.
       * `{{target}}` — tên loại kết nối. Ví dụ: `Jira`.
       */
      committed:
        'Ticket đã được tạo ở {{target}}. Gửi lại tới kết nối này chỉ gửi nốt phần còn thiếu; ' +
        'chữ đã sửa sẽ không được áp dụng.',
      /** Hết lượt gửi lại hoặc lỗi lạ. */
      failed: 'Gửi thất bại',
      /**
       * Trước nút Gửi lại của bản `failed` mà ticket CHƯA chắc đã tạo: lần gửi hỏng có thể vẫn tới
       * đích. `{{target}}` — tên loại kết nối. Ví dụ: `Jira`.
       */
      checkFirst: 'Có thể đã có ticket ở {{target}}. Kiểm tra ở đó trước khi gửi lại.',
      /** Nút chia sẻ bản báo còn trong hàng đợi (thất bại, bị chặn, không chắc đã gửi…). */
      share: 'Chia sẻ',
      /** Nút bỏ bản báo khỏi hàng đợi. Bấm lần đầu chỉ hỏi lại. */
      discard: 'Bỏ bản báo',
      /** Nút bỏ bản báo sau lần bấm đầu — bấm lần nữa mới bỏ thật. */
      discardConfirm: 'Bỏ thật?',
      /**
       * Hàng đợi chỉ nằm trong RAM (app không bật `persist`, spec 5.6) — hiện ở các trạng thái còn
       * chờ: xếp hàng, không chắc đã gửi, gửi thất bại.
       */
      ramOnly: 'Bản báo chỉ nằm trong bộ nhớ, sẽ mất nếu app bị tắt.',
    },
    /**
     * Trang Hàng đợi gửi (spec 4.5, 5.6): mọi bản báo hàng đợi còn giữ — QA mở từ banner đầu form để
     * gửi lại, chia sẻ hay bỏ những bản không gửi được sau khi sheet đã đóng.
     */
    queue: {
      /** Tiêu đề trang (tiêu đề sheet). */
      title: 'Hàng đợi gửi',
      /**
       * Banner đầu form khi hàng đợi còn bản chưa gửi xong. `{{summary}}` — các đoạn đếm
       * (`countWaiting`, `countAttention`) nối bằng ` · `. Ví dụ: `2 chờ gửi · 1 cần xử lý`.
       */
      banner: 'Hàng đợi gửi: {{summary}} — chạm để xem',
      /** Đoạn đếm bản hàng đợi đang tự lo (đang gửi / chờ gửi lại). `{{count}}` — số bản, ≥ 1. */
      countWaiting: '{{count}} chờ gửi',
      /** Đoạn đếm bản QA phải ra tay. `{{count}}` — số bản, ≥ 1. */
      countAttention: '{{count}} cần xử lý',
      /** Nhóm: gửi thất bại · bị chặn · không chắc đã gửi. */
      sectionAttention: 'Cần xử lý',
      /** Nhóm: đang gửi · chờ gửi lại. */
      sectionWaiting: 'Đang chờ gửi',
      /** Nhóm: đã gửi xong, hàng đợi còn giữ 24 giờ. */
      sectionSent: 'Đã gửi (giữ 24 giờ)',
      /** Hàng đợi không còn bản nào. */
      empty: 'Hàng đợi trống.',
      /** Bản báo có tiêu đề trống. */
      untitled: '(Chưa có tiêu đề)',
      /** Tên kết nối khi kết nối của bản báo đã bị xoá. */
      connectionGone: 'Kết nối không còn',
      /** Hàng đợi chỉ nằm trong RAM (app không bật `persist`, spec 5.6). */
      ramOnly: 'Hàng đợi chỉ nằm trong bộ nhớ, các bản báo sẽ mất nếu app bị tắt.',
      /** Thời gian tương đối: dưới một phút. */
      justNow: 'vừa xong',
      /** Thời gian tương đối. `{{count}}` — số phút, 1–59. */
      minutesAgo: '{{count}} phút trước',
      /** Thời gian tương đối. `{{count}}` — số giờ, 1–23. */
      hoursAgo: '{{count}} giờ trước',
      /** Thời gian tương đối. `{{count}}` — số ngày, ≥ 1. */
      daysAgo: '{{count}} ngày trước',
      /** Nhãn trạng thái ngắn trên hàng: đang gửi. */
      stateSending: 'Đang gửi',
      /** Nhãn trạng thái: chờ hàng đợi tự gửi lại. */
      statePending: 'Chờ gửi lại',
      /** Nhãn trạng thái: request có thể đã tới đích. */
      stateUncertain: 'Chưa chắc đã gửi',
      /** Nhãn trạng thái: hết lượt gửi lại hoặc lỗi lạ. */
      stateFailed: 'Gửi thất bại',
      /** Nhãn trạng thái: token hết hạn, thiếu quyền, đích từ chối, kết nối không còn. */
      stateBlocked: 'Bị chặn',
      /** Nhãn trạng thái: đã gửi xong. */
      stateSent: 'Đã gửi',
    },
  },
  /** Màn kết nối: trang danh sách, form sửa kết nối, và chữ riêng của từng loại kết nối. */
  connections: {
    /** Trang danh sách kết nối (`ConnectionsPage`). */
    page: {
      /** Tiêu đề trang — sheet chứa trang đặt nó ở header. */
      title: 'Kết nối',
      /** Nút quay về màn trước. */
      back: 'Quay lại',
      /** App không cấp `secureStore` (spec 5.5): trang chỉ hiện câu này. */
      noSecureStore: 'App chưa cấp kho bảo mật',
      /** Đang đọc danh sách từ kho bảo mật. */
      loading: 'Đang tải kết nối…',
      /** Chưa lưu kết nối nào. */
      empty: 'Chưa có kết nối nào. Thêm một kết nối để gửi bug thẳng tới Jira, Slack, Lark hoặc webhook.',
      /** Nút mở bước chọn loại kết nối. */
      add: '+ Thêm kết nối',
      /** Tiêu đề nhóm nút chọn loại kết nối. */
      chooseType: 'Chọn loại kết nối',
      /** Mức của kết nối không gửi được ảnh/file (Slack, Lark qua webhook). */
      levelLight: 'Nhẹ',
      /** Mức của kết nối gửi được ảnh và file. */
      levelFull: 'Đầy đủ',
      /**
       * Dòng phụ của một kết nối. `{{type}}` — tên loại, `{{level}}` — mức. Ví dụ: `Slack · Nhẹ`.
       */
      rowSubtitle: '{{type}} · {{level}}',
      /**
       * Gợi ý bí mật đã lưu — chỉ 4 ký tự cuối (spec 5.5). `{{label}}` — nhãn ô, `{{masked}}` — dạng
       * che. Ví dụ: `API token ••••1a2b`.
       */
      secretHint: '{{label}} {{masked}}',
      /** Kết nối trỏ tới loại app không còn đăng ký. `{{id}}` — id loại. Ví dụ: `linear`. */
      unknownType: 'Loại "{{id}}" không còn trong app',
      /** Nút sửa một kết nối. */
      edit: 'Sửa',
      /** Nhãn trợ năng của nút sửa. `{{name}}` — tên kết nối. */
      editA11y: 'Sửa kết nối "{{name}}"',
      /** Nút xoá một kết nối (bước 1, còn hỏi lại). */
      delete: 'Xoá',
      /** Nhãn trợ năng của nút xoá. `{{name}}` — tên kết nối. */
      deleteA11y: 'Xoá kết nối "{{name}}"',
      /** Câu hỏi lại trước khi xoá. `{{name}}` — tên kết nối. Ví dụ: `Jira DEMO`. */
      deleteConfirm: 'Xoá "{{name}}"? Bí mật đã lưu của kết nối này cũng bị xoá.',
      /** Nút xác nhận xoá. */
      deleteYes: 'Xoá hẳn',
      /** Nút bỏ ý định xoá / bỏ chọn loại. */
      cancel: 'Huỷ',
      /** Xoá không thành (lỗi kho bảo mật). */
      deleteFailed: 'Không xoá được kết nối. Thử lại.',
      /** Đọc danh sách không thành (lỗi kho bảo mật). */
      loadFailed: 'Không đọc được danh sách kết nối. Thử lại.',
    },
    /** Danh sách kết nối đã lưu bị hỏng (ruling R18): lối thoát "Đặt lại kết nối". */
    reset: {
      /** Giải thích vì sao phải đặt lại, và đặt lại làm mất gì. */
      notice:
        'Danh sách kết nối đã lưu bị hỏng nên không đọc được. Đặt lại sẽ xoá mọi kết nối đã lưu, sau đó tạo lại từ đầu.',
      /**
       * Kho bảo mật ném khi đọc hai lần lưu/xoá liền nhau (ruling R39 — vd khoá Keystore Android bị
       * thu hồi). Phải nói rõ đặt lại xoá mọi kết nối **và bí mật** của chúng.
       */
      unreadable:
        'Không đọc được kho bảo mật nhiều lần liền (có thể khoá của kho đã bị hệ điều hành thu hồi). Đặt lại sẽ xoá mọi kết nối đã lưu cùng bí mật của chúng; sau đó tạo lại từ đầu.',
      /** Nút đặt lại. */
      action: 'Đặt lại kết nối',
      /** Đặt lại không thành (lỗi kho bảo mật). */
      failed: 'Không đặt lại được kết nối. Thử lại.',
    },
    /** Form thêm/sửa một kết nối (`ConnectionEditor`), dựng từ `fields()` của loại kết nối. */
    editor: {
      /** Tiêu đề khi thêm — sheet chứa form đặt ở header. `{{type}}` — tên loại. Ví dụ: `Slack`. */
      titleNew: 'Thêm kết nối {{type}}',
      /** Tiêu đề khi sửa. `{{name}}` — tên kết nối. */
      titleEdit: 'Sửa "{{name}}"',
      /** Nhãn ô tên kết nối (hiện ở danh sách và nút Gửi). */
      name: 'Tên kết nối',
      /** Nhãn ô ngôn ngữ ticket (spec 11.2). */
      ticketLocale: 'Ngôn ngữ ticket',
      /** Gợi ý ô ngôn ngữ ticket. */
      ticketLocaleHelp: 'Tiêu đề các mục và thông tin máy trong ticket viết bằng ngôn ngữ này.',
      /** Lựa chọn tiếng Việt. */
      localeVi: 'Tiếng Việt',
      /** Lựa chọn tiếng Anh. */
      localeEn: 'English',
      /** Nút dán từ bộ nhớ tạm vào ô bí mật. */
      paste: 'Dán',
      /** Nhãn trợ năng của nút Dán. `{{label}}` — nhãn ô. Ví dụ: `API token`. */
      pasteA11y: 'Dán vào ô "{{label}}"',
      /** Bí mật đã lưu (khi sửa): chỉ hiện dạng che. `{{masked}}` — ví dụ `••••1a2b`. */
      savedSecret: 'Đã lưu {{masked}}. Để trống để giữ nguyên.',
      /** Ô chọn chưa có lựa chọn — lựa chọn đến từ bước Thử kết nối. */
      optionsAfterTest: 'Bấm "Thử kết nối" để tải danh sách.',
      /** Ô chọn phụ thuộc ô khác chưa chọn. `{{label}}` — nhãn ô cha. Ví dụ: `Project`. */
      optionsAfterParent: 'Chọn "{{label}}" trước.',
      /** Đang tải lựa chọn của một ô. */
      optionsLoading: 'Đang tải danh sách…',
      /** Đích trả danh sách rỗng. */
      optionsEmpty: 'Không có lựa chọn nào.',
      /** Đang đọc các trường bắt buộc của đích (Jira). */
      extraLoading: 'Đang đọc các trường bắt buộc…',
      /**
       * Trường bắt buộc kiểu chưa hỗ trợ mà loại kết nối không kèm câu báo (spec 11.3). `{{name}}` —
       * tên trường, `{{type}}` — kiểu ở đích. Ví dụ: `Sprint`, `gh-sprint`.
       */
      unsupportedField:
        'Trường {{name}} (kiểu {{type}}) chưa hỗ trợ, nhờ admin đặt giá trị mặc định hoặc bỏ bắt buộc.',
      /** Nút thử kết nối. */
      test: 'Thử kết nối',
      /** Thử kết nối thành công, đích không nêu tài khoản. */
      testOk: 'Kết nối thành công.',
      /** Thử kết nối thành công. `{{account}}` — tài khoản/nơi nhận do đích trả. Ví dụ: `Nguyễn QA`. */
      testOkAccount: 'Kết nối thành công: {{account}}',
      /** Nút lưu kết nối. */
      save: 'Lưu',
      /** Nút bỏ form. */
      cancel: 'Huỷ',
      /** Vì sao Lưu bị khoá: chưa thử kết nối thành công với thông tin hiện tại. */
      needTest: 'Cần "Thử kết nối" thành công với thông tin hiện tại trước khi lưu.',
      /** Vì sao Lưu bị khoá: còn ô bắt buộc trống. */
      needRequired: 'Còn ô bắt buộc chưa điền.',
      /** Vì sao Lưu bị khoá: đích bắt buộc một trường lib chưa hỗ trợ. */
      needSupported: 'Có trường bắt buộc chưa hỗ trợ nên chưa lưu được kết nối này.',
      /** Tiêu đề cảnh báo bí mật sống lâu (spec 5.4.2). */
      longLivedTitle: 'Bí mật này nằm lâu dài trên máy',
      /** Cảnh báo bí mật sống lâu (spec 5.4.2), hiện một lần trước khi lưu. */
      longLived:
        'Bí mật này mở được mọi quyền của app và được lưu trên máy này. Nên nhờ admin tạo một app riêng cho báo bug với quyền tối thiểu (Slack: files:write, chat:write; Lark: im:resource và một quyền gửi tin). Có thể thu hồi bất cứ lúc nào ở console của nền tảng.',
      /** Nút đồng ý cảnh báo và lưu. */
      longLivedConfirm: 'Đã hiểu, lưu',
      /** Lỗi `auth`. */
      errAuth: 'Sai email hoặc token, hoặc token đã hết hạn',
      /** Lỗi `permission` của Jira (spec 5.4.1: Atlassian Guard có thể chặn API token). */
      errJiraPermission:
        'Không đủ quyền, hoặc tổ chức chặn API token (Atlassian Guard). Liên hệ admin Jira',
      /** Lỗi `permission` của loại khác, khi loại kết nối không kèm câu riêng. */
      errPermission: 'Không đủ quyền với đích này. Liên hệ admin của đích.',
      /** Lỗi `network`: không có phản hồi nào. */
      errNetwork: 'Không có mạng hoặc không tới được máy chủ. Kiểm tra mạng rồi thử lại.',
      /** Lỗi `uncertain`: quá thời gian chờ. */
      errUncertain: 'Máy chủ không trả lời kịp. Thử lại sau.',
      /** Lỗi `rate-limit`. */
      errRateLimit: 'Đích đang giới hạn tần suất. Thử lại sau ít phút.',
      /** Lỗi khác (`unknown`, lỗi lạ). Chi tiết của đích (nếu có) hiện ở dòng dưới. */
      errUnknown: 'Không thử được kết nối.',
      /** Lưu không thành (lỗi kho bảo mật). */
      saveFailed: 'Không lưu được kết nối vào kho bảo mật. Thử lại.',
    },
    /** Loại kết nối Webhook (gửi `multipart/form-data` tới URL của khách). */
    webhook: {
      /** Tên loại kết nối. */
      label: 'Webhook',
      /** Nhãn ô URL. */
      url: 'URL nhận báo bug',
      /** Gợi ý của ô URL. */
      urlHelp: 'Server nhận POST multipart/form-data: phần "report" (JSON) và các file.',
      /** Nhãn ô tên header (tuỳ chọn). */
      headerName: 'Tên header (tuỳ chọn)',
      /** Nhãn ô giá trị header — là bí mật, sau khi lưu chỉ hiện 4 ký tự cuối. */
      headerValue: 'Giá trị header',
      /** Gợi ý của hai ô header. */
      headerHelp: 'Dùng cho khoá xác thực, ví dụ Authorization hoặc X-Api-Key.',
      /** URL không hợp lệ (không phải http/https hoặc thiếu host). */
      urlInvalid: 'URL không hợp lệ. Nhập địa chỉ dạng https://…',
      /** URL dùng http thường ở host không phải máy thử. */
      urlNotSecure: 'URL phải dùng https (http chỉ cho phép với localhost hoặc 10.0.2.2).',
      /** Tên header không hợp lệ. */
      headerNameInvalid: 'Tên header không hợp lệ.',
    },
    /** Loại kết nối Jira Cloud (tạo issue mô tả bằng ADF rồi đính kèm file). */
    jira: {
      /** Tên loại kết nối. */
      label: 'Jira Cloud',
      /** Nhãn ô địa chỉ site. */
      site: 'Địa chỉ Jira',
      /** Gợi ý của ô địa chỉ site. */
      siteHelp: 'Dạng https://ten-cong-ty.atlassian.net',
      /** Nhãn ô email của tài khoản Atlassian. */
      email: 'Email tài khoản Atlassian',
      /** Nhãn ô API token — là bí mật, sau khi lưu chỉ hiện 4 ký tự cuối. */
      token: 'API token',
      /** Gợi ý của ô API token: nơi tạo và hạn dùng tối đa 365 ngày (spec 5.4.1). */
      tokenHelp:
        'Tạo ở id.atlassian.com › Security › API tokens. Token hết hạn sau tối đa 365 ngày; khi đó hãy tạo token mới và nhập lại.',
      /** Nhãn ô chọn project (danh sách lấy khi Thử kết nối). */
      project: 'Project',
      /** Nhãn ô chọn loại issue (danh sách theo project đã chọn). */
      issueType: 'Loại issue',
      /** Gợi ý của ô nhãn (labels) bắt buộc: nhãn Jira không chứa dấu cách. */
      labelsHelp: 'Nhiều nhãn thì cách nhau bằng dấu cách.',
      /** Địa chỉ site sai dạng, hoặc dùng http thường. */
      siteInvalid: 'Địa chỉ Jira không hợp lệ. Nhập dạng https://ten-cong-ty.atlassian.net',
      /** Site không trả lời như một Jira Cloud (404 ở cả site lẫn gateway). */
      siteNotFound: 'Không tìm thấy Jira ở địa chỉ này. Kiểm tra lại địa chỉ site.',
      /** Một ô bắt buộc còn trống. `{{label}}` — nhãn ô. Ví dụ: `Email tài khoản Atlassian`. */
      fieldMissing: 'Chưa điền "{{label}}".',
      /**
       * Trường bắt buộc của Jira có kiểu chưa hỗ trợ (spec 11.3). `{{name}}` — tên trường, `{{type}}`
       * — kiểu ở Jira. Ví dụ: `Sprint`, `gh-sprint`.
       */
      fieldUnsupported:
        'Trường {{name}} (kiểu {{type}}) chưa hỗ trợ, nhờ admin đặt giá trị mặc định hoặc bỏ bắt buộc.',
      /** Trường bắt buộc của Jira trống hoặc sai dạng lúc gửi. `{{name}}` — tên trường. */
      fieldInvalid: 'Trường {{name}} chưa có giá trị hợp lệ. Mở kết nối để điền lại.',
    },
    /** Loại kết nối Slack: mức nhẹ (incoming webhook) hoặc mức đầy đủ (bot token + upload ngoài). */
    slack: {
      /** Tên loại kết nối. */
      label: 'Slack',
      /** Nhãn ô chọn cách kết nối. */
      mode: 'Cách kết nối',
      /** Gợi ý của ô chọn cách kết nối: mức nhẹ không gửi được ảnh/file (giới hạn của Slack). */
      modeHelp:
        'Webhook: chỉ gửi chữ, không có ảnh hay file. Bot: gửi kèm ảnh và file, cần một Slack app do admin cài.',
      /** Lựa chọn mức nhẹ. */
      modeWebhook: 'Incoming webhook (chỉ chữ)',
      /** Lựa chọn mức đầy đủ. */
      modeBot: 'Bot token (kèm ảnh và file)',
      /** Nhãn ô webhook URL — là bí mật, sau khi lưu chỉ hiện 4 ký tự cuối. */
      webhookUrl: 'Webhook URL',
      /** Gợi ý của ô webhook URL. */
      webhookUrlHelp:
        'Tạo ở api.slack.com › Incoming Webhooks. Mỗi webhook gắn với một kênh cố định.',
      /** Nhãn ô bot token — là bí mật, sau khi lưu chỉ hiện 4 ký tự cuối. */
      botToken: 'Bot token (xoxb-…)',
      /** Gợi ý của ô bot token: quyền cần có (spec 5.4.1). */
      botTokenHelp:
        'Cần quyền files:write; thêm chat:write để gửi được cả khi không có file. Nhớ mời bot vào kênh.',
      /** Nhãn ô mã kênh. */
      channelId: 'Mã kênh (channel ID)',
      /** Gợi ý của ô mã kênh. */
      channelIdHelp:
        'Dạng C0123ABCD (không phải tên kênh). Mở kênh ở Slack › tên kênh › cuối phần About.',
      /** Một ô bắt buộc còn trống. `{{label}}` — nhãn ô. Ví dụ: `Bot token (xoxb-…)`. */
      fieldMissing: 'Chưa điền "{{label}}".',
      /** Chưa chọn cách kết nối. */
      modeInvalid: 'Chưa chọn cách kết nối Slack.',
      /** Webhook URL không phải https. */
      webhookUrlInvalid:
        'Webhook URL không hợp lệ. Nhập địa chỉ dạng https://hooks.slack.com/services/…',
      /** Mã kênh sai dạng (hay gặp: dán tên kênh). */
      channelIdInvalid:
        'Mã kênh không hợp lệ. Nhập mã dạng C0123ABCD, không phải tên kênh như #general.',
      /** Bot chưa ở trong kênh (`not_in_channel` hoặc `is_member: false`). */
      notInChannel:
        'Bot chưa ở trong kênh này. Hãy mời bot vào kênh ở Slack (gõ /invite @tên-bot), rồi gửi lại.',
      /** Slack app thiếu quyền. `{{scope}}` — quyền còn thiếu do Slack báo. */
      missingScope:
        'Slack app thiếu quyền "{{scope}}". Nhờ admin Slack thêm quyền này rồi cài lại app.',
      /** Slack app thiếu quyền nhưng Slack không nêu tên quyền. */
      missingScopeUnknown:
        'Slack app thiếu một quyền cần thiết. Nhờ admin Slack thêm quyền rồi cài lại app.',
      /** Slack trả lỗi không nằm trong các nhóm đã biết. `{{code}}` — mã lỗi của Slack. */
      apiError: 'Slack báo lỗi: {{code}}.',
      /** Thử kết nối xong nhưng không kiểm được bot có trong kênh. `{{team}}` — tên workspace. */
      membershipUnverified: '{{team}} (chưa kiểm được bot đã ở trong kênh chưa)',
    },
    /** Loại kết nối Lark / Feishu (webhook của bot nhóm, hoặc app tự dựng có ảnh và file). */
    lark: {
      /** Tên loại kết nối. */
      label: 'Lark / Feishu',
      /** Nhãn ô chọn nền tảng (hai miền riêng, spec 5.4.1). */
      domain: 'Nền tảng',
      /** Lựa chọn Lark quốc tế (open.larksuite.com). */
      domainLark: 'Lark (quốc tế)',
      /** Lựa chọn Feishu (open.feishu.cn). */
      domainFeishu: 'Feishu (Trung Quốc)',
      /** Nhãn ô chọn cách kết nối. */
      mode: 'Cách kết nối',
      /** Lựa chọn webhook bot nhóm (nhẹ: không có ảnh/file). */
      modeWebhook: 'Webhook bot nhóm (nhẹ, không có ảnh/file)',
      /** Lựa chọn app tự dựng (đầy đủ: ảnh và file). */
      modeApp: 'App tự dựng (đầy đủ, có ảnh và file)',
      /** Nhãn ô webhook URL — là bí mật (URL mang token), sau khi lưu chỉ hiện 4 ký tự cuối. */
      webhookUrl: 'Webhook URL',
      /** Gợi ý ô webhook URL. */
      webhookUrlHelp: 'Lấy ở nhóm: Cài đặt › Bot › Thêm bot › Bot tuỳ chỉnh. Dán nguyên cả URL.',
      /** Nhãn ô khoá ký (tuỳ chọn) — là bí mật. */
      signSecret: 'Khoá ký (tuỳ chọn)',
      /** Gợi ý ô khoá ký. */
      signSecretHelp: 'Chỉ điền nếu bot bật "Xác thực chữ ký".',
      /** Nhãn ô App ID. */
      appId: 'App ID',
      /** Nhãn ô App Secret — là bí mật, sau khi lưu chỉ hiện 4 ký tự cuối. */
      appSecret: 'App Secret',
      /** Cảnh báo bí mật sống lâu trên máy (spec 5.4.2). */
      appSecretHelp:
        'Lưu ý: App Secret mở được mọi quyền của app và nằm trên máy này. Nhờ admin tạo một app riêng cho báo bug với quyền tối thiểu (im:resource và một quyền gửi tin); có thể thu hồi bất cứ lúc nào ở console.',
      /** Nhãn ô mã nhóm. */
      chatId: 'Mã nhóm (chat ID)',
      /** Gợi ý ô mã nhóm. */
      chatIdHelp: 'Dạng oc_xxxxxxxx. Bot phải đã được thêm vào nhóm này.',
      /** Webhook URL sai dạng hoặc sai host. */
      webhookInvalid:
        'Webhook URL không hợp lệ. Cần dạng https://open.larksuite.com/open-apis/bot/v2/hook/… (Feishu: open.feishu.cn) và khớp nền tảng đã chọn.',
      /** Mã nhóm sai dạng. */
      chatIdInvalid: 'Mã nhóm không hợp lệ. Mã có dạng oc_xxxxxxxx.',
      /** Một ô bắt buộc còn trống. `{{label}}` — nhãn ô. */
      fieldMissing: 'Chưa điền "{{label}}".',
      /** Chữ thay thế của ảnh màn hình trong thẻ. */
      imageAlt: 'Ảnh màn hình',
      /** Bot không ở trong nhóm hoặc không được gửi vào nhóm. */
      errBotNotInChat:
        'Bot chưa ở trong nhóm này (hoặc không được gửi tin vào đây). Hãy thêm bot vào nhóm rồi thử lại.',
      /** Chữ ký sai hoặc đồng hồ máy lệch quá 1 giờ (mã 19021). */
      errSign: 'Chữ ký không khớp hoặc đồng hồ máy lệch quá 1 giờ. Kiểm tra khoá ký và giờ của máy.',
      /** IP không nằm trong danh sách cho phép (mã 19022). */
      errIp: 'Bot chỉ nhận yêu cầu từ các IP được phép, máy này không nằm trong danh sách.',
      /** Tin không chứa từ khoá của bot (mã 19024). */
      errKeyword:
        'Tin không chứa từ khoá nào mà bot yêu cầu. Nhờ admin nhóm bỏ quy tắc từ khoá hoặc thêm một từ khoá.',
      /** App ID/App Secret bị từ chối hoặc token hết hạn. */
      errCredentials:
        'Lark từ chối App ID hoặc App Secret, hoặc token đã hết hạn. Kiểm tra cả hai rồi thử lại.',
      /** App thiếu quyền hoặc chưa được admin duyệt. */
      errNoPermission:
        'App thiếu quyền cần thiết hoặc admin chưa duyệt. Nhờ admin cấp và phát hành quyền (im:resource và một quyền gửi tin).',
      /** Bị giới hạn tần suất. */
      errRate: 'Lark đang giới hạn tần suất gửi. Thử lại sau ít phút.',
      /** Thử kết nối xong nhưng không đọc được thông tin nhóm nên không kiểm được bot có ở trong nhóm. */
      testNoRead:
        'Thông tin đăng nhập hợp lệ, nhưng app không đọc được thông tin nhóm nên chưa kiểm được bot có ở trong nhóm.',
    },
  },
} as const;
