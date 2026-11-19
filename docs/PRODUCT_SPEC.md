# Product specification

| Module | MVP workflow |
| --- | --- |
| Tổng quan | Real/test selector, counts, pending handovers, grounded rate, latency, seven-day activity and recent threads |
| Kho tri thức | Search title and body, categorize, create, edit, review, publish and restore a historical version as a draft. Import one TXT/Markdown document or up to 30 CSV rows with `title,category,body` |
| Nhân cách AI | Edit the configurable instruction, brand voice, response rules and fallback language. Persona preferences guide the model’s choice of phrasing, source and follow-up |
| Huấn luyện AI | Start a correction from conversation history or manually, approve it, then publish into knowledge in one transaction |
| Phòng thử nghiệm | Multi-turn chat with reason, latency, provider, generation method and linked source revisions |
| Sản phẩm | Maintain names, notes, VND prices, availability and HTTPS image URLs. Retrieval uses current rows |
| Hội thoại | Read threads, filter handovers, change status, record internal support replies, pause automation, start corrections and delete a thread |
| Tích hợp | See channel status, submit mock Messenger events and observe deduplication. Signed ingress and outbound are gated. Staging is mock-only. Instagram and Website have adapter contracts |
| Mô hình AI | Mock or opt-in Workers AI, allowlisted models, UTC call and estimated Neuron ceilings |
| Cài đặt | Edit display name, see authentication mode, review the latest 50 changes and snapshots, and set customer data retention |

The only active workspace is NẾP MÙI. An administrator can approve and publish. Multiple reviewer identities, role separation and locale switching are follow-up work. Approval and publication are separate actions. Editing a reviewed knowledge item saves it as a draft and immediately removes the previously published version from retrieval. Images are remote URLs. Conversations retain the latest 40 messages per thread. The Messenger send transport is disabled by default and requires separate launch approval.
