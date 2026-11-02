# ⇄ TransFlow — Bộ Gõ & Chuyển Ngữ Ngay Tại Chỗ (VI · EN · JA · ZH)

[![Website HTTPS Trực Tuyến](https://img.shields.io/badge/Live_Web_App-HTTPS_Online-06b6d4?style=for-the-badge)](https://hducduy2006-hub.github.io/transflow/)
[![Tải Chrome Extension](https://img.shields.io/badge/Chrome_Extension-v1.0.0_(.zip)-4f46e5?style=for-the-badge)](https://github.com/hducduy2006-hub/transflow/releases/latest/download/transflow-extension.zip)

Công cụ phiên dịch realtime ngay khi đang gõ và thay thế văn bản **ngay tại chỗ** bên trong **Messenger, Zalo Web, Gmail, Slack, Discord, Facebook, ChatGPT** và mọi trang web — kèm **Web App HTTPS chạy trực tiếp 24/7 trên trình duyệt** để chia sẻ cho mọi người cùng dùng.

👉 **Dùng trực tiếp ngay trên Web (PC & Điện thoại):** **[https://hducduy2006-hub.github.io/transflow/](https://hducduy2006-hub.github.io/transflow/)**

---

## ✨ Tính năng nổi bật

1. **Gõ & Chuyển ngữ ngay tại chỗ (Smart IME Style)**
   - Gõ Tiếng Việt (hoặc Anh / Nhật / Trung) → Thanh xem trước (Preview) nổi lên ngay cạnh con trỏ sau `0.3s` (tương thích mượt với Unikey / EVKey / Telex / Kana / Pinyin).
   - Ấn **`Tab`** (hoặc **`Alt + Q`** / bấm nút **`Xác nhận`**) → Đoạn vừa gõ lập tức biến thành ngôn ngữ đích ngay trong ô chat!
   - **Gõ nối tiếp đa ngôn ngữ**: Sau khi đổi câu 1 sang Tiếng Anh, gõ tiếp câu 2 bằng Tiếng Việt ngay sau đó → Công cụ tự nhận biết và chỉ dịch phần câu mới!
   - **Hoàn tác 1 chạm (`Alt + Z` / nút `↩ Hoàn tác`)**: Khôi phục lại câu gốc bất cứ lúc nào.

2. **Chuyển đổi mượt mà giữa 4 ngôn ngữ chính**
   - 🇻🇳 **Tiếng Việt (`Alt + 1`)**
   - 🇬🇧 **Tiếng Anh (`Alt + 2`)**
   - 🇯🇵 **Tiếng Nhật (`Alt + 3`)** — kèm phiên âm cách đọc **Romaji**
   - 🇨🇳 **Tiếng Trung Giản thể (`Alt + 4`)** & 🇹🇼 **Phồn thể** — kèm phiên âm **Pinyin**
   - **Tự động đảo chiều thông minh (`Auto-Pivot`)**: Đang chọn đích Tiếng Anh mà gõ câu Tiếng Anh sẽ tự động dịch ngược sang Tiếng Việt.

3. **Kết hợp Dịch Miễn Phí (Dùng ngay) + Tùy chọn nâng cấp Gemini AI**
   - **Mặc định**: Dùng ngay 100% miễn phí, không cần tài khoản hay API Key.
   - **Nâng cấp tùy chọn (Gemini AI)**: Nhập Gemini API Key miễn phí từ Google AI Studio để chọn văn phong (**Tự nhiên**, **Lịch sự / Kính ngữ Keigo**, **Thân mật**, **Ngắn gọn**) và hiểu ngữ cảnh câu trước.

---

## 🧩 Hướng dẫn cài Chrome / Edge / Cốc Cốc Extension (30 giây)

1. Tải gói cài đặt **[`transflow-extension.zip`](https://github.com/hducduy2006-hub/transflow/releases/latest/download/transflow-extension.zip)** và giải nén ra một thư mục (hoặc clone repo này và chọn thư mục `extension/`).
2. Mở trình duyệt và truy cập `chrome://extensions` (hoặc `edge://extensions`).
3. Bật công tắc **Developer mode (Chế độ dành cho nhà phát triển)** ở góc trên bên phải.
4. Bấm **Load unpacked (Tải tiện ích đã giải nén)** → Chọn thư mục `transflow-extension` (hoặc `extension`).
5. Mở **Messenger, Zalo Web, Gmail...**, gõ thử một câu Tiếng Việt và ấn `Tab`!

---

## 📂 Cấu trúc dự án

```text
transflow/
├── extension/              # Mã nguồn Chrome Extension (Manifest V3)
│   ├── manifest.json       # Cấu hình quyền & content scripts
│   ├── background.js       # Bộ định tuyến dịch thuật (Google GTX + MyMemory + Gemini AI + Cache)
│   ├── content.js          # Bộ gõ thông minh tại chỗ + Thanh nổi Shadow DOM
│   └── popup.html/css/js   # Giao diện cài đặt nhanh trên thanh công cụ trình duyệt
├── web/                    # Trang Web App HTTPS chạy trực tiếp & chia sẻ công khai
├── build_release.py        # Công cụ tự động tạo icon PNG & đóng gói .zip
└── cap_nhat_web_https.bat  # Cập nhật nhanh lên GitHub Pages chỉ với 1 cú nhấp đúp
```
