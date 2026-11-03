"""Self-contained HTML email: inline styles, system fonts and selectable codes."""
from html import escape


def code_email_html(code: str, *, title: str, instruction: str, notice: str) -> str:
    # Keep the code as one text node: copying preserves all six digits, including zeros.
    code, title, instruction, notice = map(escape, (code, title, instruction, notice))
    return f"""<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title} — ТАРЕЛКА</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f7f2;color:#203a2b;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">{title}. Код действует 10 минут.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f7f2">
    <tr><td align="center" style="padding:32px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="max-width:480px;border:1px solid #e0e8dc;border-radius:24px;">
        <tr><td style="padding:32px 24px 28px;">
          <p style="margin:0 0 28px;color:#23814d;font-size:16px;line-height:22px;font-weight:bold;letter-spacing:3px;">ТАРЕЛКА</p>
          <h1 style="margin:0 0 12px;color:#203a2b;font-size:26px;line-height:34px;font-weight:bold;">{title}</h1>
          <p style="margin:0 0 24px;color:#617064;font-size:15px;line-height:24px;">{instruction}</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f0f7ee" style="border:2px solid #c9dcc3;border-radius:16px;">
            <tr><td align="center" style="padding:20px 12px 22px;">
              <p style="margin:0 0 10px;color:#57704f;font-size:12px;line-height:18px;">Ваш одноразовый код</p>
              <div dir="ltr" style="color:#245a35;font-family:'Courier New',Courier,monospace;font-size:36px;line-height:44px;font-weight:bold;letter-spacing:8px;white-space:nowrap;"><span style="padding-left:8px;">{code}</span></div>
            </td></tr>
          </table>
          <p style="margin:14px 0 0;text-align:center;color:#617064;font-size:13px;line-height:20px;">Действует <strong style="color:#3c5842;">10 минут</strong>. Никому не сообщайте код.</p>
        </td></tr>
        <tr><td style="padding:20px 24px 24px;border-top:1px solid #edf0e9;">
          <p style="margin:0;color:#788277;font-size:12px;line-height:20px;">{notice}</p>
        </td></tr>
      </table>
      <p style="margin:20px 0 0;color:#82907d;font-size:12px;line-height:18px;">С заботой о вашем дне, ТАРЕЛКА</p>
    </td></tr>
  </table>
</body>
</html>"""
