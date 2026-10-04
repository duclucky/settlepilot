# Runtime Agent tối giản học từ Hermes

Ngày: 2026-09-29. Trạng thái: user đã chọn kiến trúc và cho phép triển khai trong phạm vi sản phẩm hiện tại.

## Mục tiêu

Tameion dùng GPT-5.4 làm bộ não chọn hành động. Backend chỉ cung cấp observation, tool có schema, policy validation, side effect và proof. Không có nhánh backend tự chọn thay source chain hoặc nghĩa vụ khi model không đưa ra quyết định.

Kiến trúc học bốn cơ chế từ Hermes Agent của Nous Research:

1. `AGENTS.md` chứa mục tiêu của payment agent; `POLICY.md` là constitution luôn được đưa vào prompt giống vai trò của `SOUL.md` trong cách lắp context của Hermes.
2. `SKILL.md` là procedural memory, chỉ nạp đầy đủ khi model gọi `read_skill`.
3. Memory là fact/lesson bền vững, có giới hạn, được model sửa qua tool và không có authority.
4. Vòng lặp GPT gọi tool, nhận JSON result rồi tiếp tục cho tới `finish`; backend dispatch tool theo registry cố định.

Không lấy terminal, browser, messaging, cron, delegation, plugin marketplace, nhiều agent, SOUL/USER profile hoặc tool tự cài đặt của Hermes.

## Toolset duy nhất

- `read_skill(name)`: đọc một skill thanh toán từ allowlist local.
- `read_evidence(obligationIds)`: đọc evidence không đáng tin của nghĩa vụ đã biết.
- `check_policy(obligationIds)`: xem deterministic planning status; không tạo side effect.
- `inspect_treasury()`: xem snapshot Arc và source-chain inventory đã xác minh.
- `choose_funding_source(sourceChain)`: model chọn chain cho kế hoạch thiếu thanh khoản; backend chỉ validate và ghi lựa chọn trong plan.
- `memory(action, ...)`: thêm, thay hoặc xóa fact/lesson bền vững; không được chứa credential hay sửa policy.
- `request_user_decision(obligationId, policyReason, question)`: Agent tự phát hiện xung đột policy và dừng để xin quyết định có thẩm quyền từ workspace owner.
- `finish(decisions)`: kết thúc plan đầy đủ. Đây không phải tool gửi tiền.

## Ranh giới quyết định

LLM quyết định nghĩa vụ, thứ tự, giữ/yêu cầu evidence, có dùng CCTP và source chain. Backend lấy recipient/amount từ registry có thẩm quyền, tính deficit và phí, kiểm tra balance/policy, lưu intent rồi mới thực thi. Nếu chain model chọn thất bại, backend đánh dấu observation thất bại và yêu cầu một vòng model mới; không tự fallback sang chain khác.

Policy đầy đủ được đưa vào initial context trước khi model quyết định. Agent phải tự nhận ra xung đột qua policy context và `check_policy`; nếu không có giải pháp tự hành hợp lệ, nó gọi `request_user_decision` ngay thay vì thử ép `PAY_NOW` hoặc chờ backend đổi quyết định.

Quyết định cụ thể của workspace owner cao hơn các giới hạn vận hành có thể override: per-obligation limit, tổng budget, planning window và reserve. Override chỉ có hiệu lực một lần, gắn với obligation version, policy version, financial state, policy reason và expiry. Các bất biến chứng minh tính đúng không thể override: Arc Testnet 5042002, amount/recipient từ registry, số dư thực phải đủ amount + gas, authority hợp lệ, không có intent chưa đối soát, idempotency và receipt proof.

Execution gate chỉ kiểm chứng rằng plan và override vẫn còn đúng ở thời điểm side effect. Nếu state đổi sau planning, backend dừng giao dịch và ghi audit event; nó không viết lại quyết định của model.

Jev tiếp tục review đề xuất `PAY_NOW`. Policy, authority, reserve, budget, allowlist, idempotency và receipt proof luôn là hard constraints.

## Tiêu chí nghiệm thu

- Prompt runtime chứa đúng `agent/AGENTS.md`, toàn bộ `agent/POLICY.md`, dynamic policy snapshot, memory snapshot và skills index; không chứa toàn bộ skill chưa được gọi.
- Model phải đọc skill settlement trước `PAY_NOW`; funding plan phải đọc skill CCTP, inspect treasury và gọi `choose_funding_source`.
- Run lưu source chain do model chọn; CCTP chỉ xét chain đó và không fallback.
- Memory tool ghi bền vững, có giới hạn, hỗ trợ add/replace/remove và không thay đổi `financialVersion`.
- Tool name/arguments lạ, skill traversal, secret-like memory, incomplete decision hoặc funding thiếu source đều fail closed.
- Agent gọi `request_user_decision` khi gặp policy conflict có thể override mà nó không tự giải được; backend không tự đổi `PAY_NOW` thành `HOLD`/`REQUEST_EVIDENCE`.
- Owner có thể `APPROVE_ONCE` hoặc `KEEP_POLICY`; phản hồi được lưu bền vững rồi Agent tự chạy lại với quyết định đó trong context.
- Test không gọi model thật, RPC thật hoặc phát giao dịch.

## Xin quyết định người dùng

Khi Agent gọi `request_user_decision`, engine phải:

- dừng an toàn, không tạo payment hay bridge intent;
- lưu một request `USER_DECISION_REQUIRED` gắn với run, obligation version, policy version, financial state, policy reason và câu hỏi của Agent;
- hiển thị request nổi bật cho workspace owner để chọn `APPROVE_ONCE` hoặc `KEEP_POLICY` và ghi phản hồi;
- chạy lại Agent sau phản hồi, giữ nguyên tool trace và không tự chọn hành động thay thế.

Fallback notification chỉ dùng nếu model/provider dừng sau khi đã thấy policy rejection nhưng không gọi tool xin ý kiến. Bản thân notification không cấp authority. Chỉ phản hồi `APPROVE_ONCE` có thẩm quyền mới tạo override chính xác; `KEEP_POLICY` giữ nguyên giới hạn.

## Nguồn kiến trúc

- Hermes prompt/context files: https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/prompt-assembly.md
- Hermes memory: https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/memory.md
- Hermes skills: https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/skills.md
- Hermes tool runtime: https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/tools-runtime.md
- Hermes agent loop summary: https://github.com/NousResearch/hermes-agent/blob/main/agent/AGENTS.md

Các nguồn được đối chiếu ngày 2026-09-29. Implementation được viết riêng cho Tameion; không copy source code Hermes.
