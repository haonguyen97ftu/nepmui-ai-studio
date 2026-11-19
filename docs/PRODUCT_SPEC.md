# Product specification

| Module | MVP workflow |
| --- | --- |
| Tổng quan | Real/test selector, counts, pending handovers, grounded rate, latency, seven-day activity and recent threads |
| Kho tri thức | Search, categorize, create, edit, delete, review and publish. Import one TXT/Markdown document or up to 30 CSV rows with `title,category,body` |
| Nhân cách AI | Edit the configurable instruction, brand voice, response rules and fallback language. Approved text controls the wording of grounded responses |
| Huấn luyện AI | Start a correction from conversation history or manually, approve it, then publish into knowledge in one transaction |
| Phòng thử nghiệm | Multi-turn chat with reason, latency, provider and selected/candidate source text |
| Sản phẩm | Maintain names, notes, VND prices, availability and HTTPS image URLs |
| Hội thoại | Read threads, filter handovers, change status, record internal support replies and start corrections |
| Tích hợp | See channel status, submit mock Messenger events and observe deduplication. Signed live Messenger ingress is gated. Instagram and Website have adapter contracts |
| Mô hình AI | Mock or opt-in Workers AI, allowlisted models, UTC call and estimated Neuron ceilings |
| Cài đặt | Edit display name, see authentication mode, review the latest 50 changes and snapshots |

The only active workspace is NẾP MÙI. An administrator can approve and publish. Multiple reviewer identities, role separation and locale switching are follow-up work. Approval and publication are separate actions. Editing a reviewed knowledge item saves it as a draft and immediately removes the previously published version from retrieval. Images are remote URLs. Conversations retain the latest 40 messages per thread. No customer-facing send transport ships in this version.
