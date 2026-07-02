// iOS falls back to a serif-style CJK font (Songti SC) when a Western serif
// font like Georgia doesn't cover a character — much less legible than the
// clean sans-serif PingFang SC that iOS uses for its own UI. Detecting CJK
// text lets us opt those specific runs out of the display serif font.
const CJK_REGEX = /[㐀-䶿一-鿿豈-﫿]/

export function containsCJK (text: string): boolean {
  return CJK_REGEX.test(text)
}
