# 101 Campaign / Content Generation Demo Runbook

## Purpose

This runbook is the operator script for showing the current Misell Studio
campaign/content generation flow. It is intentionally demo-safe: it uses the
authenticated Cloud admin UI, deterministic Scene generation, and read-only
preview/display views. It does not call external AI, render media, create a
`content_manifest`, publish, or change device delivery.

## Demo-Ready Scope

- Create a CampaignProject from admin/operator free input.
- Use the demo quick-fill control to populate a realistic CampaignBrief.
- Generate the initial three Scene drafts through the existing deterministic
  server-side generator.
- Edit Scene copy/duration in the admin UI.
- Validate the CampaignProject.
- Open the authenticated preview and full-screen display mode.
- Explain playlist/schedule handoff drafts as previews, not as publish.

## Not Yet Implemented In This Demo

- External AI image/video generation.
- Media rendering or MP4 export for CampaignProject.
- Public customer approval links.
- `content_manifest` creation or device publish.
- Ad booking, billing, quota, or guarantee workflows.
- Camera/POS based incremental attribution.

## Pre-Demo Checks

1. Open the Cloud admin URL with admin authentication.
2. Confirm the dashboard loads and a store/screen group is visible.
3. Confirm the CampaignProject panel is visible.
4. If popup blocking is enabled in the browser, plan to use the project row's
   `プレビュー` link instead of the `作成後にプレビュー` checkbox.

## Main Demo Flow

1. In Cloud admin, go to the CampaignProject section.
2. In the free-input form, click `デモ入力`.
3. Confirm these fields are populated:
   - title: `雨の日のファミリー訴求`
   - objective: rainy-day service message
   - target audience: waiting families
   - store context: station-front store / longer dwell time on rainy days
   - CTA: `QRから当日のおすすめを見る`
4. Keep `初期Sceneを自動作成` checked.
5. Optionally check `作成後にプレビュー`.
6. Click `入力から作成`.
7. Confirm a new project appears with three Scene drafts.
8. Open `プレビュー`.
9. Explain that the three panels are generated from structured CampaignBrief
   fields and remain editable draft records.
10. Return to admin, edit one Scene headline or duration.
11. Click `検証`.
12. Reopen preview and confirm the readiness panel shows the validated state.
13. Open `表示モード` to show a signage-like run-through.

## Talk Track

- "Misell does not treat AI output as final authority. The current flow turns a
  structured brief into editable Scene drafts."
- "The generation here is deterministic and script-controlled, so the demo is
  repeatable and does not spend external AI credits."
- "Publish is intentionally separated. The preview and handoff drafts let an
  operator inspect content before any content manifest or device delivery is
  created."
- "This is the foundation for later provider-based media generation. That later
  provider layer must have cost, audit, rights, and approval controls."

## Fallbacks

### Popup Does Not Open

Use the project row's `プレビュー` link. The project is already created; the
popup is only a convenience.

### No Store Or Screen Group Is Selected

Click `デモ入力` again after the dashboard data finishes loading. The button
uses existing tenant/store/screen-group options; it does not create store data.

### Validation Shows Warnings

Edit the Scene fields in admin. Common fixes:

- add CTA text
- set duration above zero
- remove definitive performance/guarantee claims
- remove personal information from Scene text

### Need A Clean Demo

Create another quick-fill project. Deletes are soft deletes, so avoid promising
that test records are physically removed.

## Evidence To Mention

- Created project and Scene rows have `no_external_ai=true`.
- The deterministic generator records generator metadata.
- Preview/display mode does not publish.
- Validation rejects missing CTA, zero duration, guaranteed outcomes, and direct
  PII in Scene text.

## Follow-Up Cells

- Provider/media generation ADR and job design.
- Asset selection/upload binding to Scenes.
- Public/customer approval preview.
- Publish conversion from validated Scene draft to `content_manifest`.
- Measurement binding from Scene/creative to QR and proof-of-play reports.
