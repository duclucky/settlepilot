# Quyết định sản phẩm — Agent trả contractor khi doanh thu về

## Cập nhật triển khai 2026-10-03

Kế hoạch 17 đã được triển khai lõi M0–M3 và kiểm chứng M4 offline trong cả hai repo. Nguồn export tự đồng bộ, finalized transfer discovery, scheduler/lease bền vững và ActionQueue Approve/Cancel/Comment đã thay luồng nhập kỹ thuật hằng ngày. Public dùng session ownership, DTO giới hạn và host admin loopback; Test Lab enqueue cùng scheduler.

Kết quả mới: local 151/151 tests, public 156/156 tests và build pass; 50/50 predicate offline mỗi repo. Chi tiết, artifacts, giới hạn và gate live/24 giờ chưa đạt ở [18-autonomous-operations-results.md](18-autonomous-operations-results.md). Các con số/luồng cũ phía dưới là lịch sử, không chứng minh nghiệm thu phiên bản mới.


Ngày: 2026-09-28. Trạng thái: **Đã chọn trọng tâm và user đã yêu cầu “bắt đầu coding”.** Tài liệu này xác định phạm vi MVP; trạng thái implementation nằm ở [03-implementation-status.md](03-implementation-status.md). Quyền gửi giao dịch cụ thể vẫn phải được cấp riêng.

Tài liệu này là nguồn hiện hành về lựa chọn sản phẩm, thay thế các phần lựa chọn và phạm vi mâu thuẫn trong `proposed-payment-scheduling-brief.md`. Brief cũ được giữ làm lịch sử nghiên cứu; kế hoạch cũ cần điều chỉnh theo phạm vi này trước khi thực thi.

## 1. Sản phẩm được chọn

**Một agent cho agency nhỏ nhận USDC: khi doanh thu về, agent kiểm tra nghĩa vụ với contractor, xác minh bằng chứng còn thiếu, chọn khoản có thể trả trong ngân sách và thanh toán ngay trên Arc Testnet, rồi đối soát kết quả.**

Một người dùng chính: chủ agency hoặc người vận hành tài chính. Một công việc chính: xử lý đợt tiền về thành các quyết định trả / giữ / cần xác nhận, với kết quả thanh toán kiểm chứng được.

**Định vị được user làm rõ khi bắt đầu coding:** sản phẩm dành cho agency và contractor toàn cầu, không giới hạn Việt Nam. Giao diện, demo và đầu ra agent mặc định bằng tiếng Anh; dữ liệu thời gian lưu ISO UTC và hiển thị múi giờ của trình duyệt. Chứng cứ có thể bằng ngôn ngữ khác; không mặc định quốc tịch hay luật thuế của người dùng. Tài liệu cộng tác với user có thể tiếp tục bằng tiếng Việt. Đây không phải tuyên bố đã hỗ trợ pháp lý hoặc compliance ở mọi quốc gia.

Giá trị cần kiểm chứng: giảm việc nối thông tin nghiệm thu, hạn trả và tiền thực có; giảm số lần chủ agency phải tự kiểm tra lại từng khoản. Không lấy số giao dịch làm thước đo duy nhất.

Phân khúc khởi đầu là agency có contractor và đã dùng hoặc có nhu cầu nhận/trả USDC. Không giả định agency nói chung cần crypto. Chưa có khách hàng hoặc pilot xác nhận.

## 2. Cơ sở lựa chọn sau khi xem lại năm RFB

| Hướng | Quyết định và đánh đổi |
|---|---|
| RFB 1 — Treasury | Không chọn làm trọng tâm: dự báo, phân bổ vốn và yield cần dữ liệu dài hơn, dễ làm rộng MVP. |
| RFB 2 — AP/AR | Có nhu cầu rõ để kiểm chứng nhưng xử lý cả hóa đơn, thu hồi nợ và gian lận quá rộng. Chỉ giữ kiểm tra nghĩa vụ và đối soát phục vụ luồng đã chọn. |
| RFB 3 — Contractor network | Chỉ giữ contractor là đối tượng nhận tiền; bỏ khám phá nhà cung cấp, chấm điểm, thương lượng và quản lý mạng lưới. |
| **RFB 4 — Business Operator** | **Chọn làm hướng chính:** vòng nhận tiền → đánh giá khả năng chi → trả nghĩa vụ → ghi nhận kết quả thể hiện được một công việc trọn vẹn. |
| RFB 5 — Compliance | Không chọn làm sản phẩm: dữ liệu và trách nhiệm xác minh lớn, khó chứng minh giá trị trong 14 ngày. Allowlist chỉ là kiểm soát quyền chi, không được gọi là screening tuân thủ. |

Đây là lựa chọn thiết kế dựa trên phạm vi và khả năng trình diễn, không phải kết luận đã có product-market fit hay dự đoán điểm thi.

Nguồn: [RFB chính thức](https://tameion.thecanteenapp.com/), đối chiếu 2026-09-28. RFB 4 mô tả cả quyền chi được cưỡng chế trong contract. MVP này chỉ dự kiến cưỡng chế ở backend, chưa đáp ứng phần đó; trình bày rõ giới hạn, không tuyên bố policy onchain. Năm RFB là gợi ý vấn đề, không mở thêm custom contract để chạy theo toàn bộ ví dụ.

## 3. Vì sao cần agent

Agent có thể đọc cập nhật nghiệp vụ có nguồn, tìm phần còn thiếu hoặc mâu thuẫn, chọn hồ sơ cần kiểm tra, đề xuất thứ tự trả và đánh giá lại khi có bằng chứng mới. Ví dụ: một milestone có email nói “xong” nhưng xác nhận nghiệm thu mới nhất vẫn yêu cầu sửa; agent phải giữ khoản đó và nêu đúng bằng chứng cần bổ sung.

Agent chỉ chọn trong tập nghĩa vụ do backend xác thực. Policy constitution và snapshot giới hạn hiện hành luôn được đưa vào LLM trước quyết định. Khi Agent không tự giải được xung đột vận hành, nó xin quyết định owner; phản hồi có thẩm quyền có thể tạo override một lần cho đúng obligation/state/policy. Văn bản thường không được tạo quyền thanh toán, đổi địa chỉ ví hoặc biến cam kết thu thành tiền có thể chi.

Đối chứng bắt buộc: rules dùng hạn trả + trạng thái nghiệm thu + giới hạn chi. Nếu agent không giúp xử lý ngoại lệ tốt hơn đối chứng trên hồ sơ thực, chưa chứng minh được nhu cầu cho lớp agent; không thêm nhiều agent để che khoảng trống này.

## 4. Phạm vi MVP

- Một doanh nghiệp, một Circle Agent Wallet dùng cùng địa chỉ EVM, một loại tiền USDC; Arc Testnet là settlement chain duy nhất. Nguồn thu CCTP V2 gồm Ethereum Sepolia, Avalanche Fuji, Optimism Sepolia, Arbitrum Sepolia, Base Sepolia, Polygon Amoy và Unichain Sepolia.
- Nhập nghĩa vụ bằng form/CSV: mã nghĩa vụ, số tiền còn lại, hạn trả, contractor, bằng chứng nghiệm thu, trạng thái tranh chấp. Một hộp cập nhật trong app, chưa tích hợp email hay ERP.
- Theo dõi khoản thu onchain đã xác nhận và ánh xạ vào hồ sơ doanh thu do người có quyền xác nhận. Tiền đến không rõ nguồn không tự mang nhãn doanh thu; chỉ hash hoặc số dư tăng chưa đủ để xác nhận một hóa đơn đã thu.
- Nếu khoản thu canonical USDC hợp lệ đến trên một source testnet được allowlist và Arc thiếu tiền cho nghĩa vụ đủ điều kiện, agent dùng CCTP V2 Forwarding Service để bridge đúng phần thiếu sang Arc. Burn và mint là hai bằng chứng riêng; chỉ mint đã xác minh mới tăng số dư có thể chi.
- Đánh giá nghĩa vụ trong cửa sổ 14 ngày. Kết quả gồm trả ngay, giữ kèm lý do, hoặc yêu cầu xác nhận cụ thể. Chỉ trả toàn bộ phần còn lại của một nghĩa vụ trong MVP, chưa thương lượng hoặc chia nhỏ khoản trả.
- Dự trữ, ngân sách và quyền chi do chủ doanh nghiệp cấu hình trước. Với hành động đã được ủy quyền và qua mọi kiểm tra, tự gửi ngay trong phiên xử lý; không cần bấm xác nhận lại từng khoản đủ điều kiện.
- Hiển thị số dư có nguồn/thời điểm, tiền đã giữ cho intent đang xử lý, quyết định, bằng chứng và trạng thái giao dịch. Chỉ đánh dấu sandbox obligation đã trả khi receipt được kiểm chứng.

Không gồm marketplace, nhiều agent, mua dịch vụ/API, yield, lending, mainnet, custom contract, payroll thuế hoặc hệ thống kế toán đầy đủ. Crosschain chỉ gồm bảy EVM testnet đã nêu → Arc Testnet bằng CCTP V2 cho việc nạp thiếu hụt; không có router tùy ý, bridge ngược chiều, crosschain payout hoặc token USDC không canonical.

## 5. Luồng và ranh giới quyền

Nhận sự kiện → xác minh khoản thu / tải dữ liệu → truyền policy + state cho Agent → Agent quyết định hoặc xin ý kiến owner → nếu có phản hồi thì lưu override/denial và đánh giá lại → nếu kế hoạch thiếu thanh khoản thì Agent chọn nguồn, backend tính deficit/quote và thực thi route đã chọn → xác minh mint Arc → Agent quan sát lại → lưu payout intent → gửi → lấy receipt → đối soát nghĩa vụ → ghi kết quả.

- Backend kiểm tra chain `5042002`, ví gửi, recipient allowlist, amount, nghĩa vụ chưa trả, hạn mức, reserve, gas và quyền thực thi. Tiền dùng integer/bigint; native và ERC-20 USDC không phải hai quỹ độc lập.
- Mức có thể chi xuất phát từ số dư đã xác minh, trừ reserve, gas dự kiến và các khoản giữ chỗ đang hiệu lực. Không tính thu nhập dự báo. Thao tác giữ ngân sách phải nguyên tử để hai run không tiêu cùng một khoản tiền.
- Lưu run, quyết định, snapshot, phiên bản policy, intent và idempotency trước submission. Gắn tổng chi với nghĩa vụ để chống chia nhỏ vượt quyền.
- Kết quả chưa rõ chuyển sang `EXECUTION_UNKNOWN`, giữ reservation và reconcile trước retry. Không giả định timeout nghĩa là chưa gửi.
- Bridge intent lưu trước side effect và chỉ được dispatch một lần. Policy khóa source/destination, amount, fee cap và recipient. Khoản thu trên source chain không được cộng vào Arc; trạng thái burn/pending attestation không cho phép trả hóa đơn.
- Thiếu chứng cứ → `NEEDS_EVIDENCE`; xung đột vận hành chưa có quyền → Agent gọi `request_user_decision`. `APPROVE_ONCE` gắn với người cấp quyền, obligation/version, policy, financial state, reason và expiry; `KEEP_POLICY` buộc Agent chọn phương án khác. Transaction truth và chống gửi sai/trùng không thể override.
- Nội dung tình huống là dữ liệu không đáng tin. Agent không có credentials hay công cụ sửa registry/policy. Có quyền dừng thực thi và lịch sử quyết định bền vững.
- Hướng tích hợp dự kiến: Circle developer-controlled wallet trên Arc Testnet. Cần xác minh account, SDK types và semantics receipt trước khi gọi là tích hợp hoạt động. Không tự dùng Circle agent-wallet policy mainnet cho phạm vi này.

## 6. Demo bắt buộc

Kịch bản minh họa, chưa phải dữ liệu khách hàng hay giao dịch đã chạy:

1. Có ba nghĩa vụ: A đã nghiệm thu và đến hạn; B đã nghiệm thu nhưng hạn muộn hơn; C có bằng chứng nghiệm thu mâu thuẫn. Các nghĩa vụ, ví và quyền được cấu hình trước.
2. Nhận một khoản USDC testnet mới vào ví vận hành trong phiên demo, xác minh nguồn và giao dịch. Tiền khả dụng sau reserve/gas đủ trả A hoặc B nhưng không đủ cả hai.
3. Agent kiểm tra hồ sơ, ưu tiên A dựa trên hạn trả, giữ B để bảo toàn reserve, giữ C và chỉ ra phần chứng cứ còn thiếu. Backend kiểm tra lại trước khi thực thi.
4. Agent gửi khoản A ngay trên Arc Testnet trong cùng run. Hiển thị hash mới, explorer, chain, sender, recipient, amount và receipt thành công; đối soát nghĩa vụ A.
5. Hiển thị vì sao B/C chưa trả và phần việc cần người vận hành xử lý. Không bắt buộc người dùng bấm “pay” sau khi agent đã quyết định trong quyền đã cấp.

Hai giao dịch mới (thu và chi) là tiêu chí của demo luồng trọn vẹn được chọn. Chuyển tiền vào có thể do người đóng vai khách hàng thực hiện; agent chịu trách nhiệm nhận biết và thực hiện khoản chi, không được coi nút chuyển tiền của người đóng vai khách hàng là quyết định của agent.

Biến thể crosschain: khách hàng chọn một source testnet được hỗ trợ và gửi canonical USDC vào cùng Agent Wallet. Agent xác minh receipt theo chain ID và USDC contract của mạng đó, tính thiếu hụt Arc cho các nghĩa vụ đủ điều kiện cộng reserve/gas, kiểm tra source balance đủ cả amount và phí CCTP, rồi bridge đúng phần thiếu. Demo hiển thị source chain, hash burn và hash mint Arc trước khi bắt đầu khoản chi contractor.

“Tức thời” nghĩa là bắt đầu gửi ngay sau kiểm tra và trong cùng phiên, không chờ lịch cron. Ghi timestamp từ sự kiện đến quyết định, submission, hash và receipt; không cam kết độ trễ đầu-cuối dưới một giây. Đoạn thanh toán phải liên tục, không thay hash cũ hoặc dùng tua nhanh để che thời gian chờ. Video cuối dưới 3 phút; giao dịch chậm thì ghi nhận thất bại rehearsal và xử lý, không đổi nhãn thành thành công.

Demo tổng hợp được gắn nhãn có thể chứng minh kỹ thuật. Chỉ hồ sơ thực được phép dùng và hành vi sử dụng thực mới là bằng chứng nhu cầu/traction. Receipt testnet chỉ đóng nghĩa vụ sandbox, không đóng công nợ ngoài đời. Không yêu cầu đưa dữ liệu nhạy cảm lên chain.

## 7. Tiêu chí nghiệm thu trước khi gọi MVP hoàn thành

1. Khoản thu chưa có xác nhận hoặc chưa ánh xạ được không bị ghi nhầm là doanh thu đã thu; cùng một sự kiện thu phát lại không tăng tiền khả dụng hai lần.
2. Agent chọn được trả/giữ/cần chứng cứ trên các tình huống chưa thấy trước, dẫn nguồn đúng và đánh giá lại sau thay đổi có thẩm quyền. Có kết quả đối chứng rules.
3. Prompt injection, wallet/chain/amount ngoài registry, thiếu gas, thiếu reserve, vượt budget và nghĩa vụ đã trả đều bị backend chặn trước side effect.
4. Hai run cùng lúc, sự kiện lặp và khởi động lại không tạo hai khoản thanh toán cho cùng nghĩa vụ; intent và reservation tồn tại bền vững.
5. Timeout sau submission không gây gửi lại mù; reconciliation tìm kết quả cũ hoặc giữ trạng thái chưa rõ. Approval hết hạn hoặc state/policy thay đổi không còn hiệu lực.
6. Demo tạo giao dịch thu mới và giao dịch chi mới trên `ARC-TESTNET`; khoản chi đi từ quyết định đủ quyền đến submission ngay trong phiên. Xác minh receipt thành công, chain, sender, recipient và amount từ dữ liệu chain phù hợp với cách chuyển đã chọn.
7. UI phân biệt provider accepted, hash, receipt đã kiểm chứng và trạng thái chưa rõ; truy được từ nghĩa vụ đến run/intent/transaction. Dừng agent ngăn submission mới.
8. Mock/replay/fault injection và sandbox hiển thị nhãn; không dùng testnet volume làm doanh thu thật. Có hướng dẫn chạy, giới hạn đã biết và bằng chứng kiểm thử để reviewer tự kiểm tra.

## 8. Điều đã biết và điều cần kiểm chứng

- **Fact:** user yêu cầu thanh toán tức thời với txn thật trên testnet. Arc Testnet dùng chainId 5042002; native USDC và ERC-20 USDC là cùng số dư theo [tài liệu Arc](https://docs.arc.io/arc/references/connect-to-arc), đối chiếu 2026-09-28.
- **Assumption:** solo/nhóm nhỏ, 14 ngày, ngân sách thấp; có thể tiếp cận agency để phỏng vấn. Chưa coi đây là cam kết đã có pilot.
- **Hypothesis:** người vận hành gặp đủ ngoại lệ và sẵn sàng cấp quyền chi giới hạn; xử lý bằng agent giảm công việc so với rules/bảng tính.
- **Decision:** một trọng tâm RFB 4 với luồng doanh thu → trả contractor; thanh toán mới trên Arc Testnet là điều kiện demo, không phải hạng mục tùy chọn.
- **Open risks:** nhu cầu USDC hẹp; agent có thể thừa so với rules; độ tin cậy thực thi/đối soát và truy cập Circle chưa được kiểm chứng runtime.

## 9. Kiểm chứng rẻ trong 48 giờ tới

Đây là kế hoạch kế tiếp, chưa có liên hệ, code hay giao dịch nào được thực hiện.

- Chuẩn bị lời mời phỏng vấn và xin phép dùng dữ liệu; chỉ gửi khi user cho phép liên hệ. Mục tiêu trao đổi với 3 người vận hành, lấy 5–10 tình huống ẩn danh từ ít nhất một bên có luồng USDC phù hợp.
- Với mỗi tình huống, ghi quyết định thực, chứng cứ cần tìm, số phút xử lý, điểm bất đồng và mức quyền họ sẵn sàng giao. So sánh đề xuất agent với rules trên cùng hồ sơ, không chỉ chấm câu giải thích hay.
- Sau khi chuyển sang giai đoạn implementation, làm lát cắt kỹ thuật nhỏ: xác minh network/balance, đọc receipt và lưu intent. Giao dịch testnet chỉ chạy khi có quyền cụ thể và cấu hình cần thiết; chưa có quyền đó trong quyết định sản phẩm này.
- Nếu không tìm được bên có nhu cầu USDC, chưa xác nhận phân khúc; nếu không có ngoại lệ mà rules xử lý kém, chưa xác nhận lợi ích agent. Ghi kết quả này trước khi mở rộng tính năng.

## Điều cần tôi trả lời tiếp

Không cần chọn lại ý tưởng; trọng tâm đã được chọn theo quyền user giao. Chưa cần chọn stack ở giai đoạn này.

## Ba rủi ro lớn nhất hiện tại

1. Chưa có agency xác nhận nhu cầu và luồng USDC phù hợp.
2. Chưa chứng minh agent tốt hơn rules ở xử lý ngoại lệ.
3. Chưa kiểm chứng quyền truy cập Circle và luồng gửi/đối soát testnet trong runtime.

## Bước kiểm chứng rẻ nhất trong 48 giờ tới

Đối chiếu 5–10 quyết định trả contractor thực với rules và đề xuất agent; song song chuẩn bị điều kiện cho một lát cắt thu → quyết định → chi → receipt trên testnet khi được phép triển khai và giao dịch.
