# Vòng lặp Agent thích ứng

## Phạm vi

Agent xử lý các nghĩa vụ thanh toán USDC có số tiền, hạn, bằng chứng và mức ưu tiên khác nhau. Arc là nơi thanh toán; treasury USDC thực tế của chính ví Agent có thể nằm trên bất kỳ testnet nào trong allowlist CCTP. Các con số và chain của kịch bản demo chỉ là dữ liệu đầu vào của một lần chạy.

## Logic cố định

1. Đọc song song số dư canonical USDC của ví Agent trên Arc và mọi source chain trong allowlist. Mỗi snapshot phải đúng chain ID, block và không quá 30 giây; chain lỗi RPC bị đánh dấu `UNAVAILABLE` và có số dư khả dụng bằng 0.
2. GPT chọn `PAY_NOW`, `HOLD` hoặc `REQUEST_EVIDENCE` cho từng nghĩa vụ và sắp thứ tự quyết định.
3. Jev review mỗi đề xuất `PAY_NOW`.
4. Model luôn nhận policy constitution và snapshot hiện hành. Nếu xung đột vận hành không tự giải được, Agent xin quyết định owner; backend chỉ validate scope của quyết định và các bất biến giao dịch.
5. Nếu kế hoạch được chọn thiếu thanh khoản trên Arc, backend tính đúng phần thiếu từ riêng các nghĩa vụ `PAY_NOW`, reserve và gas; CCTP chỉ được cấp vốn từ số dư treasury đã xác minh theo kế hoạch đã lưu bền vững.
6. Sau khi burn và mint được xác minh, Agent quan sát lại toàn bộ trạng thái và lập quyết định mới trước khi trả tiền.
7. Mỗi payout tiếp tục được kiểm tra lại ngay trước side effect và chỉ được đánh dấu hoàn tất sau receipt hợp lệ.

## Quyết định thích ứng

- Nghĩa vụ nào được trả, giữ hoặc cần thêm bằng chứng.
- Thứ tự ưu tiên giữa các nghĩa vụ đang mở.
- Có cần cấp vốn qua CCTP hay không; số tiền thiếu thay đổi theo snapshot Arc và tập `PAY_NOW`.
- Nguồn chain dùng cho CCTP được chọn từ số dư hiện tại của ví Agent và policy cho phép. Lịch sử khoản khách đã trả không được dùng làm số dư.
- Nếu một chain không đủ toàn bộ deficit cộng phí, backend tính khoản nhận lớn nhất an toàn trên chain đó. Sau mint, Agent chụp lại toàn bộ số dư và có thể tiếp tục tuần tự từ chain khác.

## Tiêu chí nghiệm thu

- Thay đổi số dư Arc làm thay đổi deficit mà không sửa code.
- Thay đổi số dư nguồn làm thay đổi chain và số tiền CCTP mà không sửa code; khoản thu lịch sử không làm tăng liquidity.
- Thay đổi amount hoặc tập nghĩa vụ `PAY_NOW` làm thay đổi chính xác số tiền CCTP.
- `HOLD` và `REQUEST_EVIDENCE` không được tính vào nhu cầu vốn.
- Quyết định owner chính xác có thể vượt per-item, budget, planning window hoặc reserve; chain, recipient, amount, số dư thực, authority, reconciliation, idempotency và receipt proof vẫn bắt buộc.
- Kế hoạch bị vô hiệu khi trạng thái tài chính thay đổi trước lúc tạo bridge intent.
- Sau CCTP mint, Agent lập kế hoạch mới; kế hoạch trước bridge không thể trực tiếp chi tiền.
- Kiểm thử bao phủ nhiều số dư, số tiền lẻ 6 chữ số, source RPC lỗi, CCTP bị tắt và funding từng phần từ nhiều source chain; không phát giao dịch thật trong test.
