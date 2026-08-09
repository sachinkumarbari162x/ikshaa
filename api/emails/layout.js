'use strict';

/* ============================================================================
 * The shell every Ikshaa email is built in.
 *
 * Email HTML is not web HTML. What is written here looks twenty years out of
 * date on purpose, because the constraints are real:
 *
 *   - TABLES, not flex or grid. Outlook renders through Word's engine and
 *     understands neither.
 *   - INLINE styles. Gmail strips <style> from forwarded mail, so anything
 *     that only lives in a stylesheet vanishes at the worst moment.
 *   - NO web fonts. Cormorant Garamond will not load in most clients, so the
 *     stack falls to Georgia, which is present nearly everywhere and is the
 *     closest thing to the site's voice.
 *   - IMAGES ARE OPTIONAL. Most clients block them until the reader asks.
 *     Nothing here may depend on one loading — the letter has to read
 *     completely with every image missing.
 *   - 600px. Still the width that survives every client and every phone.
 *
 * Colours are the site's: cream #EFE6D6, ink #2E2A24, accent #8C6A45.
 * ========================================================================= */

const CREAM = '#EFE6D6';
const INK = '#2E2A24';
const ACCENT = '#8C6A45';
const PAPER = '#FFFFFF';

const SERIF = "Georgia, 'Cormorant Garamond', 'Times New Roman', serif";
const SANS = "'Helvetica Neue', Helvetica, Arial, sans-serif";

/* Anything interpolated into HTML gets escaped. A name is guest-supplied
   text, and "O'Brien & Sons <hello>" must not become markup. */
function esc(text) {
  return String(text === null || text === undefined ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function button(href, label) {
  /* A table, not an <a> with padding: Outlook collapses the padding and the
     button becomes a bare link. The nested table is what holds its shape. */
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0;">
    <tr>
      <td align="center" bgcolor="${INK}" style="border-radius:6px;">
        <a href="${esc(href)}"
           style="display:inline-block;padding:15px 34px;font-family:${SANS};
                  font-size:13px;letter-spacing:0.16em;text-transform:uppercase;
                  color:${CREAM};text-decoration:none;border-radius:6px;">${esc(label)}</a>
      </td>
    </tr>
  </table>`;
}

/**
 * Wrap body HTML in the house shell.
 *
 * `unsubscribe` is not optional in practice. Without a visible way out, the
 * only route off a list is the spam button, and enough of those poison the
 * sending domain for everybody still on it.
 */
function shell(options) {
  const preheader = options.preheader || '';
  const unsubscribe = options.unsubscribe || '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${esc(options.title || 'Ikshaa')}</title>
</head>
<body style="margin:0;padding:0;background-color:${CREAM};">

<!-- The preview line in an inbox list. Without it, clients pull the first
     words of the body, which is usually a greeting and says nothing. -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">
  ${esc(preheader)}
  <!-- padded so the client stops pulling body text in after it -->
  ${'&#847;&zwnj;&nbsp;'.repeat(60)}
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="background-color:${CREAM};">
  <tr>
    <td align="center" style="padding:32px 16px;">

      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
             style="width:600px;max-width:100%;background-color:${PAPER};border-radius:10px;">

        <!-- masthead: type, not an image, so it survives images being blocked -->
        <tr>
          <td align="center" style="padding:34px 34px 6px;">
            <div style="font-family:${SERIF};font-size:30px;letter-spacing:0.12em;
                        color:${INK};">IKSHAA</div>
            <div style="font-family:${SANS};font-size:11px;letter-spacing:0.24em;
                        text-transform:uppercase;color:${ACCENT};padding-top:8px;">
              Loutolim &middot; South Goa
            </div>
          </td>
        </tr>

        <tr>
          <td style="padding:22px 34px 34px;font-family:${SERIF};font-size:17px;
                     line-height:1.72;color:${INK};">
            ${options.body}
          </td>
        </tr>

        <tr>
          <td style="padding:0 34px;">
            <div style="border-top:1px solid rgba(46,42,36,0.14);"></div>
          </td>
        </tr>

        <tr>
          <td style="padding:22px 34px 34px;font-family:${SANS};font-size:12px;
                     line-height:1.7;color:rgba(46,42,36,0.62);">
            <div>Carman &middot; Ikshaa, Loutolim, South Goa</div>
            <div style="padding-top:6px;">
              <a href="mailto:nyaragoa@gmail.com"
                 style="color:${ACCENT};text-decoration:none;">nyaragoa@gmail.com</a>
            </div>
            ${unsubscribe ? `
            <div style="padding-top:14px;">
              <a href="${esc(unsubscribe)}"
                 style="color:rgba(46,42,36,0.62);text-decoration:underline;">
                Stop receiving these</a>
            </div>` : ''}
          </td>
        </tr>

      </table>

    </td>
  </tr>
</table>
</body>
</html>`;
}

module.exports = { shell, button, esc, CREAM, INK, ACCENT, SERIF, SANS };
