# Tự hành trong quyền đã cấp

User yêu cầu ngày 2026-10-03: tăng khả năng tự hành, hạn chế xin ý kiến. Triển khai trên local và public, không mở rộng quyền chi, không thêm dependency hoặc giao dịch để kiểm thử.

LLM tiếp tục quyết định nghĩa vụ, source CCTP và phương án chờ. Backend cung cấp quan sát, lưu lịch, gọi lại LLM và kiểm tra trước side effect. Không thay LLM bằng thuật toán thanh toán hoặc tự nâng HOLD thành payout.

## Mốc triển khai và nghiệm thu

1. Thêm tool `wait_for_conditions`: LLM chọn chờ ngắn có lý do và lịch re-evaluate bền vững, tối đa 15 phút mỗi lần và 5 lần cùng điều kiện chưa đổi. Nguồn mới, owner response và deadline vẫn đánh thức scheduler. Không dùng tool để vượt owner rejection hoặc giả acceptance/funds. Bằng chứng: restart giữ lịch, đến hạn gọi lại model, không thanh toán khi chưa đủ tiền.
2. Truyền context đầy đủ cho LLM: expected receivables, các source unavailable/stale, worker recovery/backoff, operation pending và lần chờ trước. Prompt/skill yêu cầu ưu tiên recovery, chờ nguồn thu có căn cứ hoặc funding; không coi RPC unavailable là cạn ví. Hết phương án/đủ cửa sổ retry mới xin giúp đỡ; policy cần quyết định owner vẫn có thể hỏi ngay.
3. Tool `queue_owner_request` lưu câu hỏi chính xác theo từng nghĩa vụ, không dừng cả plan. LLM tiếp tục quyết định các nghĩa vụ còn lại; candidate đang xin ý kiến phải HOLD/REQUEST_EVIDENCE, không được gửi. Giữ tool legacy, nhưng hướng dẫn dùng scoped request. Request không cấp approval; recipient, amount, digest/version vẫn validate. Nghiệm thu: một item cần owner, item khác vẫn được xử lý; question trùng không tạo proposal mới.
4. Tích hợp timer vào scheduler, giữ lease/idempotency/reconciliation và owner delay. Đến hạn timer gọi LLM dù input không đổi, không gọi wallet trực tiếp. Kết quả đã chờ được expose đúng phạm vi, public không lộ câu hỏi/context private. Tests offline meaningful RED/GREEN, full tests/build hai repo, audit 50 offline và reload panel database settled; không coi offline là 50 live.

## Ranh giới

Không tự sửa policy hoặc tăng budget, per-item, allowlist, reserve hay thời hạn authority. Không tự giải quyết tranh chấp, nhận công việc chưa có acceptance, resend giao dịch unknown, hoặc gửi tiền sang ví khác. Owner instruction giữ ưu tiên như đã thiết kế; LLM dùng memory/context để quyết định, không coi chúng là quyền mới.

Phục hồi gas/CCTP/receipt tiếp tục worker hiện hành. Chờ có lịch là phương án tự hành, không phải đã thanh toán. Mỗi vấn đề vẫn một Telegram incident; owner chỉ nhận các câu hỏi cần quyền hoặc can thiệp thực chất. Không claim mức tự hành tuyệt đối từ unit tests hoặc một route demo.

## Kết quả triển khai — 2026-10-03

Đã triển khai cả bốn mốc trong local và public. Tool wait lưu trạng thái và timer SQLite, reuse lịch trùng, giới hạn năm lần cùng context; timer được rút ngắn theo deadline còn ở tương lai và expiry authority. Owner delay/rejection, acceptance và hard constraints giữ nguyên. Scheduler không bỏ qua timer khi input chưa đổi, không bỏ qua retry job thất bại; pending financial operation vẫn chặn dispatch mới để reconcile.

LLM có context source unavailable/stale, expected receivables với số tiền còn thiếu, pending operations, worker health/backoff và wait history. `queue_owner_request` kiểm tra captured planning time và exact state/policy/obligation version, không cấp approval; candidate phải HOLD. Một item cần owner không dừng plan của các item khác. Nếu thanh toán item khác làm proposal cũ stale, backend thu hồi và enqueue một lượt LLM mới; không tự rebind approval. Public chỉ thấy timer của scenario mình, không thấy wait reason/context key private.

7 regression mới: wait restart/dedup/bound; deadline/expiry/owner delay/acceptance; timer và retry gọi model; scoped question tiếp tục item khác và re-propose sau settlement; missing RPC chọn HOLD thay PAY_NOW; recovery đủ năm lần mới hỏi; slow scoped question không bị mất eligibility chỉ vì model chạy hơn 30 giây. Bốn test đầu đã thấy RED trước implementation, sau sửa GREEN. Final local **178/178**, public **183/183**, TypeScript/Vite builds pass. `tests/autonomous-loop.test.ts`: **50/50 offline**, dùng fake adapters/decision fixture, không phải 50 LLM/onchain cases.

Hai ca **GPT-5.4 thật** trên synthetic state, chỉ plan và không tạo wallet/bridge adapter: (1) PAY_NOW item A và queue approval riêng item B; Jev ALLOW 0.95; (2) RPC unavailable chọn wait_for_conditions và HOLD, zero owner request. Lần thử đầu cố ý thiếu evidence supplemental: Jev ALLOW 0.76 dưới threshold 0.8 nên thành REQUEST_EVIDENCE; giữ nguyên artifact thất bại, không hạ threshold. Bổ sung evidence acceptance fixture cho ca thứ hai kiểm chứng được nhánh hợp lệ. Jev uncertainty vẫn có thể cần owner review; không tuyên bố loại bỏ mọi câu hỏi.

Panel đã reload bản mới trên database settled cũ, browser hiển thị Agent monitoring, zero owner requests và all obligations settled. Read-only verifier lúc **2026-10-03T15:42:47.870Z** xác nhận zero pending/open obligations, một payout dispatch lịch sử, balance Arc 0.06 USDC; không phát sinh giao dịch trong nâng cấp này. Scope testnet cũ đã hết hạn tại 15:17:55.955Z; không gia hạn hoặc tăng budget.

Artifacts local bị ignore: `data/implementation-verification/autonomy-upgrade-verification.json`, `autonomy-real-model-plans.json`, `autonomy-real-model-plans-attempt-1.json`, `autonomy-upgrade-local-tests.log`, `autonomy-upgrade-offline-50.log`. Public: `data/autonomy-upgrade-public-tests.log`. Shared source hashes đã đối chiếu; public-only session isolation được giữ nguyên. Chưa chạy lại live CCTP/payout hoặc soak dài cho phiên bản nâng cấp này.
