# Kitsu Auto Typeset

A Photoshop UXP panel for typesetting manga/comic scripts. Import a script, select a speech bubble, press **APPLY**, and the line is placed as a styled paragraph text layer fitted to the bubble. The queue then moves on to the next bubble.

- Author: Kitsui Mizukawa
- Version: 1.0.0
- Host: Adobe Photoshop **23.3 or newer** (tested on Photoshop 2024, Windows 11; macOS not tested)
- License: GPL-3.0

[Bahasa Indonesia ↓](#bahasa-indonesia)

## Features

- **Script queue.** Import a `.txt` script (UTF-8, one line per bubble). Lines are classified by tag into bubbles, skipped lines (SFX, notes, page numbers) and page separators. You can edit lines directly in the CURRENT card.
- **APPLY + next.** Make a selection in a bubble (for example with the Magic Wand) and press APPLY. The text layer is created inside the selection with the style matching the line's tag. Then CURRENT moves to the next bubble.
- **Shape wrap** (Psacs-kp v4). Line breaks follow the bubble silhouette: Ellipse, Diamond, Sine or None. A live shaping preview is shown in the Notes view.
- **Auto-resize** to the bubble (bounding box, shape factor or selection area). **Resize −/+** and **Soften −/+** buttons work on existing text.
- **Multi-Bubble mode.** Queue several selections, then **APPLY ALL** places every bubble. Each bubble is one history state.
- **Font styles.** Styles are grouped in folders, and each style has one or more tags. You can import TypeR style JSON (merge, or replace with an automatic backup) and export a Kitsu JSON.
- **Style buttons.** Restyle the text inside a selection, or paste the CURRENT line with a specific style.
- **Clean Bubble.** Fill the selected bubble with its background color, with per-area or single-color detection. Alternatively, the action bar button can be set to **Replace text**.
- Every action is a single Photoshop history state, so **Ctrl+Z** undoes it. Undoing an APPLY also moves CURRENT back to that line (redo moves it forward again), so the next APPLY places the same text.
- **WYSIWYG preview.** APPLY places exactly the line breaks shown in the shaping preview, including when you adjust the preview's W/H/Softness sliders.
- **UI font size.** Settings → Appearance → UI Font Size: Auto (default) or a custom base size.

## Installation

Option A: UXP Developer Tool (recommended)
1. Download this repository (Code → Download ZIP) and extract it.
2. Open **Adobe UXP Developer Tool** → **Add Plugin** → choose `manifest.json`, then **Load**.

Option B: plugin folder (how the author runs it on Windows)
1. Copy the repository folder to `%APPDATA%\Adobe\UXP\Plugins\External\kitsu.auto.typeset`.
2. Restart Photoshop.

Open the panel from **Plugins → Kitsu Auto Typeset**.

## Quick start

1. **Font Settings**: import a TypeR JSON or press **+ Add style**. Give each style a tag, for example `[]:`, and tick the folder you want to use.
2. **Notes**: press **Import .txt**. Lines that start with a style tag become bubbles. Lines without a tag are skipped by default (Settings → General → *Lines without a tag* → Paste changes this).
3. In Photoshop, select a bubble with the Magic Wand, then press **APPLY + next**.

Script format notes:
- The longest matching tag wins. The follow tag `//` reuses the style of the previous bubble line (for double bubbles).
- Default skip tags include `##`, `Page`, `SFX` and the digits `0`–`9`, so lines starting with a digit are treated as page numbers and skipped. Edit this in Settings → General.

## Settings and data

- Everything (script queue, settings, style library, one backup slot each) is stored in the plugin's local storage. Use Settings → Data to export or import settings and to restore the previous styles or settings.
- Log: Settings → Behavior → Log level. **save log** writes `kitsu-log.txt` to the plugin data folder (`%APPDATA%\Adobe\UXP\PluginsStorage\PHSP\<version>\External\kitsu.auto.typeset\PluginData\`). The log can contain short snippets of your script, so check it before sharing it in a bug report.
- Permissions: local file access only (open/save dialogs and the log file). No network access, no telemetry.
- For large documents, keep Photoshop's History States at 10–20 to save RAM.

## Known limitations

- The script cannot be pasted into the panel like in TypeR / TypeRtools: Kitsu runs on UXP, Adobe's newer plugin system, which limits clipboard paste into panels (TypeR and TypeRtools use the older CEP system). Import a `.txt` file instead.
- Multi-Bubble mode is not optimal yet; single-bubble Apply is more reliable.
- Keyboard shortcuts: UXP plugins cannot register shortcuts in Photoshop. Kitsu is still working out a way to make shortcuts work well.
- The Diamond shape can be slightly asymmetric top to bottom.
- Word width is estimated with one global factor (calibrated on CCOriginStory), so very wide or narrow fonts wrap less accurately.
- Bubble detection uses the Magic Wand and can fail on gradient or noisy bubbles, or on bubbles touching artwork.
- Replace text deletes the old layer and creates a new one, so layer effects, masks and names of the old layer are not kept.
- Only tested on Photoshop 2024 (Windows). Photoshop 23.3–24.x, macOS, and 16-bit or CMYK documents with Clean Bubble have not been verified.
- A single extremely long line (thousands of words) can make shape wrap slow.

## License

GPL-3.0. See [LICENSE](LICENSE).

---

## Bahasa Indonesia

Panel UXP Photoshop untuk typesetting naskah manga/komik. Impor naskah `.txt`, buat selection di balon, lalu tekan **APPLY**. Teks ditempel sebagai paragraph text layer ber-style yang pas di balon, kemudian antrian maju ke balon berikutnya.

- Syarat: Photoshop **23.3+** (diuji di Photoshop 2024, Windows 11).
- Cara pasang: UXP Developer Tool → Add Plugin → pilih `manifest.json`. Cara lain: salin folder ke `%APPDATA%\Adobe\UXP\Plugins\External\kitsu.auto.typeset`, lalu restart Photoshop.
- Mulai cepat:
  1. Di **Font Settings**, impor JSON TypeR atau tambah style, beri tag (mis. `[]:`), lalu centang folder yang dipakai.
  2. Di **Notes**, tekan **Import .txt**.
  3. Buat selection balon dengan Magic Wand, lalu tekan **APPLY + next**.
- Fitur: shape wrap (Ellipse/Diamond/Sine), auto-resize, Resize/Soften −/+, Multi-Bubble (APPLY ALL), tombol style untuk restyle, Clean Bubble atau Replace text, ukuran font UI (Settings → Appearance). Setiap aksi = 1 history state (Ctrl+Z); undo APPLY ikut memundurkan baris CURRENT (redo memajukan lagi). Hasil APPLY sama persis dengan preview.
- Baris tanpa tag di-skip secara default (ubah di Settings → General). Baris yang diawali angka dianggap nomor halaman dan di-skip.
- Data tersimpan di penyimpanan lokal plugin. Log (`kitsu-log.txt`) bisa memuat potongan naskah. Plugin tidak memakai jaringan.
- Multi-Bubble belum optimal; Apply satu balon lebih andal.
- Shortcut keyboard belum ada: plugin UXP tidak bisa mendaftarkan shortcut di Photoshop. Kitsu masih mencari cara agar shortcut bisa berjalan dengan baik.
- Keterbatasan lain: lihat bagian *Known limitations* di atas.

Lisensi: GPL-3.0.
