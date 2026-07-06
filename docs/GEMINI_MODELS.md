# Gemini API Model Standard for ContractorSystem

Last verified: 2026-05-25 via the live Gemini API `models` endpoint for the configured project key.

## Current Project Standard

| Purpose | API model | UI branding |
|---|---|---|
| Main document/OCR/Radar/Pricing/Letter analysis | `gemini-3.5-flash` | Gemini 3.5 Flash |
| Lightweight classification and short tasks | `gemini-3.1-flash-lite` | Gemini 3.1 Flash Lite |
| Fallback if the main model is temporarily unavailable | `gemini-2.5-flash` | Gemini 2.5 Flash |

Central config: `src/lib/gemini.ts`.

## Required Rules

1. All Gemini calls must go through `src/lib/gemini.ts`.
2. Do not hardcode model names inside API routes or UI components.
3. For structured analysis, keep JSON mode enabled where supported.
4. For document analysis, parse Gemini output defensively: prefer strict JSON, but recover a valid JSON object if the model adds surrounding text.
5. Do not use deprecated preview models for core production flow.

## Explicitly Not Allowed As Project Standard

| Model | Reason |
|---|---|
| `gemini-3-pro-preview` | Deprecated/shut down in official Gemini API docs as of 2026-03-09. |
| `gemini-3-flash-preview` | Still available for this API key, but superseded by `gemini-3.5-flash` for this project. |
| `gemini-1.5-*` | Legacy generation; not suitable for current project standard. |
| `gemini-2.0-*` | Legacy generation; do not use unless a future official migration note requires it. |

## Verification Command

Run this before changing the model standard:

```powershell
node -e "require('dotenv').config({path:'.env.local'}); const key=process.env.GEMINI_API_KEY||process.env.NEXT_PUBLIC_GEMINI_API_KEY; fetch('https://generativelanguage.googleapis.com/v1beta/models?key='+key).then(r=>r.json()).then(j=>console.log((j.models||[]).map(m=>m.name).join('\n')))"
```
