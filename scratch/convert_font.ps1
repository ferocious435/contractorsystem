$b = [Convert]::ToBase64String([IO.File]::ReadAllBytes('public/Assistant-Regular.ttf'))
"export const HEBREW_FONT_BASE64 = '$b';" | Out-File -Encoding utf8 src/lib/fonts.ts
