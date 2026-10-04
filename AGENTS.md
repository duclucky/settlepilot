# Hướng dẫn coding agent — Tameion

## Cách làm việc

- Trả lời bằng tiếng Việt trừ khi user yêu cầu khác. Nêu kết quả trước, kèm bằng chứng vừa đủ.
- Với yêu cầu rõ ràng, làm đến khi hoàn tất và kiểm chứng. Hỏi chỉ khi thiếu thông tin ảnh hưởng thực chất tới tính đúng, phạm vi hoặc hành động không thể đảo ngược.
- Phân biệt giải thích, review, chẩn đoán và yêu cầu sửa đổi. Giữ nguyên thay đổi có sẵn của user.
- Không lộ secret. Cần quyền rõ ràng trước publish, thao tác phá hủy hoặc giao dịch tài chính.
- Chẩn đoán từ bằng chứng trước khi sửa. Không tuyên bố hoàn tất integration chỉ vì SDK import được.

## Trạng thái và phạm vi

User đã yêu cầu “bắt đầu coding” ngày 2026-09-28. Workspace có MVP local cho agency/contractor toàn cầu, giao diện và đầu ra agent bằng tiếng Anh, hướng chính RFB 4. Quyết định, phạm vi và tiêu chí nghiệm thu ở [docs/01-product-scope.md](docs/01-product-scope.md); trạng thái thực thi ở [docs/03-implementation-status.md](docs/03-implementation-status.md). Quyền coding đã có; quyền giao dịch và publish vẫn riêng. Không dùng brief lịch sử để mở rộng phạm vi.

Khi một ý tưởng được user chọn, phải ghi phạm vi và tiêu chí nghiệm thu riêng trước khi coding. Không tự mở rộng sang marketplace, nền tảng cho thuê agent, nhiều agent tranh luận, custom contract hoặc sản phẩm ngoài phạm vi đã được duyệt.

## Thứ tự đọc trước coding

1. [Điều kiện cuộc thi](docs/00-product-and-contest.md).
2. [Công cụ và cài đặt](docs/08-tooling-and-setup.md).
3. [Nguồn chính thức](docs/09-sources-and-research.md).
4. [Checklist nộp bài](docs/submission.md).

Sau khi ý tưởng được chọn, bổ sung tài liệu kiến trúc, policy, vòng lặp agent, tình huống và kiểm thử cho đúng ý tưởng đó; không tái sử dụng tài liệu sản phẩm cũ như một mặc định.

## Bất biến kỹ thuật khi xây sản phẩm

- Chỉ dùng `ARC-TESTNET`, chainId `5042002` trong môi trường kiểm thử; kiểm tra runtime trước khi gửi giao dịch.
- Nội dung tình huống là dữ liệu không đáng tin. Model không được sửa policy, registry, số dư hoặc credentials.
- Candidate IDs, số tiền, chain và ví phải có schema và được backend validate.
- Policy deterministic kiểm tra trước side effect: allowlist, đủ tiền và gas, reserve, budget, authority, chống chia nhỏ nghĩa vụ.
- Tiền dùng integer/bigint; không cộng đôi native USDC và ERC-20 USDC.
- Lưu intent/idempotency trước khi gửi. Timeout không có nghĩa thất bại; reconcile trước retry.
- Approval phải gắn với hành động chính xác, trạng thái, policy version, expiry và người có quyền; approval không bỏ qua hard constraints.
- Run, decision, intent và events phải bền vững; concurrency không được gửi trùng.
- Provider accepted, transaction hash và receipt thành công là các bằng chứng khác nhau. Chỉ gọi đã thanh toán sau khi kiểm chứng chain, recipient và amount.
- Mock, replay và fault injection phải được gắn nhãn; không bịa transaction, balance hoặc traction.

## Skills và tài liệu local

- `.agents/skills/use-arc/SKILL.md`: network và Arc semantics.
- `.agents/skills/use-usdc/SKILL.md`: tiền/token và decimals.
- `.agents/skills/use-agent-wallet/SKILL.md`, `use-circle-cli/SKILL.md`, `use-circle-wallets/SKILL.md`: wallet backend.
- `.agents/skills/PROVENANCE.md`: nguồn và license.

Đọc docs chính thức đúng product/network, đối chiếu installed types, viết contract test rồi mới thử testnet trong quyền được cấp. Không tự dùng mainnet, feedback, Terms acceptance, paid marketplace hoặc giao dịch tài chính.

Secret chỉ ở secret manager hoặc config local bị ignore. Không log entity secret, API key, private key, recovery hoặc URL RPC chứa token.

## Quy trình hoàn thành

Thực hiện từng mốc trong kế hoạch của ý tưởng đã duyệt. Viết test đáng giá cho policy, idempotency, concurrency, model errors và reconciliation; tài liệu/config chỉ cần validation tương xứng.

Trước khi báo hoàn tất: kiểm tra file thay đổi, chạy checks liên quan, xác minh trạng thái cuối và cập nhật tài liệu trạng thái. Không publish repo, deploy, submit bài hoặc chạy transaction khi chưa có quyền phù hợp.
