/**
 * Embed mode: a Tikèm page shown inside the Tikèm app hides the site's own
 * chrome (Navbar, OrganizerTopNav, bottom bar, footer, install prompt: every
 * element marked data-site-chrome, see app/globals.css). The app frames the
 * page with its own header, so the site's bars on top of it read as leftovers
 * of the website (from Tikra 4945896a, TestFlight 2026-11-25).
 *
 * Two signals turn it on:
 *  - the app's WebViews add "TikemApp" to the user agent;
 *  - a link carries ?embed=1, for pages the app opens in the system's in-app
 *    browser, whose user agent the app cannot change. It is remembered for
 *    that tab (sessionStorage), so a link followed inside the page stays
 *    chrome-free.
 *
 * Runs inline in <head> (app/layout.tsx) before paint, so the chrome never
 * flashes. Kept as source text so Jest can run the exact script.
 */
export const EMBED_PARAM = 'embed'

export const EMBED_MODE_SCRIPT =
  "(function(){var k='tikem-embed',q=/[?&]embed=1(&|$)/.test(location.search),on=/TikemApp/.test(navigator.userAgent)||q;" +
  "try{if(q)sessionStorage.setItem(k,'1');else if(sessionStorage.getItem(k)==='1')on=true}catch(e){}" +
  "if(on)document.documentElement.setAttribute('data-in-app','')})()"
