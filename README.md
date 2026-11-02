# TransFlow — Bộ Gõ & Chuyển Ngữ Ngay Tại Chỗ (VI · EN · JA · ZH)

Công cụ phiên dịch realtime ngay khi đang gõ và thay thế văn bản **ngay tại chỗ** bên trong **Messenger, Zalo Web, Gmail, Slack, Discord, Facebook, ChatGPT** và mọi trang web — kèm **Web App chạy trực tiếp trên trình duyệt** để dễ dàng chia sẻ cho mọi người cùng dùng.

---

## ✨ Tính năng nổi bật

1. **Gõ & Chuyển ngữ ngay tại chỗ (Smart IME Style)**
   - Gõ Tiếng Việt (hoặc Anh / Nhật / Trung) → Thanh xem trước (Preview) nổi lên ngay cạnh con trỏ sau `0.3s` (không làm giật bộ gõ Unikey / EVKey / Telex / Kana / Pinyin).
   - Ấn **`Tab`** (hoặc **`Alt + Q`** / bấm nút **`Xác nhận`**) → Đoạn vừa gõ lập tức biến thành ngôn ngữ đích ngay trong ô chat!
   - **Gõ nối tiếp đa ngôn ngữ**: Sau khi đổi câu 1 sang Tiếng Anh, bạn gõ tiếp câu 2 bằng Tiếng Việt ngay sau đó → Công cụ tự nhận biết và chỉ dịch phần câu mới!
   - **Hoàn tác 1 chạm (`Alt + Z` / nút `↩ Hoàn tác`)**: Khôi phục lại câu gốc bất cứ lúc nào.

2. **Chuyển đổi mượt mà giữa 4 ngôn ngữ chính**
   - 🇻🇳 **Tiếng Việt (`Alt + 1`)**
   - 🇬🇧 **Tiếng Anh (`Alt + 2`)**
   - 🇯🇵 **Tiếng Nhật (`Alt + 3`)** — kèm phiên âm cách đọc **Romaji**
   - 🇨🇳 **Tiếng Trung Giản thể (`Alt + 4`)** & 🇹🇼 **Phồn thể** — kèm phiên âm **Pinyin**
   - **Tự động đảo chiều thông minh (Auto-Pivot)**: Đang để đích Tiếng Anh mà bạn gõ câu Tiếng Anh sẽ tự động dịch ngược sang Tiếng Việt.

3. **Kết hợp Dịch Miễn Phí (Dùng ngay) + Tùy chọn nâng cấp Gemini AI**
   - **Mặc định**: Dùng ngay 100% miễn phí, không cần tạo tài khoản hay API Key — chia sẻ cho ai người đó dùng được liền.
   - **Nâng cấp tùy chọn (Gemini AI)**: Nhập Gemini API Key miễn phí từ Google AI Studio để chọn văn phong (**Tự nhiên**, **Lịch sự / Kính ngữ Keigo**, **Thân mật**, **Ngắn gọn**) và hiểu ngữ cảnh câu trước.

---

## 🚀 Cách 1: Cài Tiện Ích Chrome / Edge / Cốc Cốc / Brave (Gõ trực tiếp trong Messenger, Zalo Web, Gmail...)

1. Mở trình duyệt và truy cập: `chrome://extensions` (hoặc `edge://extensions`).
2. Bật công tắc **Developer mode (Chế độ dành cho nhà phát triển)** ở góc trên bên phải.
3. Bấm **Load unpacked (Tải tiện ích đã giải nén)** và chọn thư mục:
   `extension`
4. Mở ngay **Messenger, Zalo Web, Gmail...**, gõ thử một câu Tiếng Việt và ấn `Tab`!

---

## 🔒 Chạy Với Chuẩn Bảo Mật `HTTPS://` (Có Ổ Khóa SSL Chuẩn Quốc Tế)

### Phương án A: Tạo link `https://...` công khai tức thì ngay trên máy (1 cú nhấp đúp)
Chỉ cần nhấp đúp vào file **`start_https.bat`** trong thư mục dự án:
- Tự động kết nối qua **Cloudflare HTTPS Tunnel** và cấp ngay một đường dẫn **`https://....trycloudflare.com`** có chứng chỉ SSL thật (không cảnh báo bảo mật) để bạn mở dùng hoặc gửi ngay cho bạn bè, đồng nghiệp mở trên cả PC lẫn Điện thoại.

### Phương án B: Chạy `https://` vĩnh viễn 24/7 (Kể cả khi tắt máy tính)
Tôi đã đóng gói sẵn file **`transflow-web-deploy.zip`** (kèm cấu hình ép chuyển hướng `HTTPS` tự động và bảo mật `HSTS`):
1. **Cách nhanh nhất (15 giây)**: Truy cập [Netlify Drop](https://app.netlify.com/drop) hoặc **Cloudflare Pages**, kéo thả file `transflow-web-deploy.zip` (hoặc thư mục `web`) vào trình duyệt → Nhận ngay tên miền đẹp `https://ten-cua-ban.netlify.app` hoặc `https://ten-cua-ban.pages.dev` có ổ khóa SSL xanh vĩnh viễn.
2. **Hoặc GitHub Pages / Vercel**: Đưa thư mục `web` lên GitHub và bật GitHub Pages.
