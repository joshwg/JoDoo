package main

import (
	"html/template"
	"net/http"
	"net/url"
	"regexp"
)

// joinKeyPattern mirrors the share-key generator in keys.go: exactly 20
// lowercase alphanumeric characters. Anything else 404s without touching
// the store.
var joinKeyPattern = regexp.MustCompile(`^[a-z0-9]{20}$`)

// joinPageTmpl is the landing page behind a share link
// (https://server/join/<key>). It is served without authentication, so it
// must never reveal anything about the share - it only echoes back the key
// that was already in the URL and offers to open the app.
var joinPageTmpl = template.Must(template.New("join").Parse(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Jodoo shared list</title>
<style>
  body { font-family: -apple-system, Roboto, "Segoe UI", sans-serif; background: #fffdf5;
         color: #222; margin: 0; padding: 24px; text-align: center; }
  .card { max-width: 420px; margin: 48px auto; background: #fff; border-radius: 12px;
          padding: 24px; box-shadow: 0 2px 10px rgba(0,0,0,0.12); }
  h1 { font-size: 20px; }
  p { color: #555; font-size: 15px; line-height: 1.5; }
  a.open { display: inline-block; background: #1a5fb4; color: #fff; text-decoration: none;
           font-weight: bold; border-radius: 8px; padding: 12px 24px; margin: 16px 0; }
  code { display: block; font-size: 18px; letter-spacing: 1px; color: #1a5fb4;
         margin: 12px 0; user-select: all; }
</style>
</head>
<body>
<div class="card">
  <h1>Someone shared a Jodoo list with you</h1>
  <a class="open" href="{{.DeepLink}}">Open in Jodoo</a>
  <p>If nothing happens, install the Jodoo app first, then choose
     &ldquo;Join Shared List&rdquo; and enter this key:</p>
  <code>{{.Key}}</code>
  <p>Your app must also be connected to this server &mdash; ask the person
     who shared the list for the server address and access key.</p>
</div>
</body>
</html>
`))

// handleJoinPage serves the share-link landing page. Registered without
// requireAuth on purpose: the page is what a brand-new user taps before
// they have any credentials. It never queries the store, so it neither
// confirms nor denies that a key actually exists.
func (s *Server) handleJoinPage(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("key")
	if !joinKeyPattern.MatchString(key) {
		http.NotFound(w, r)
		return
	}
	// Reconstruct the public base URL for the deep link. Behind the usual
	// TLS-terminating proxy the scheme arrives in X-Forwarded-Proto; when
	// hit directly (development) it is plain http.
	proto := r.Header.Get("X-Forwarded-Proto")
	if proto == "" {
		proto = "http"
	}
	// template.URL: html/template would otherwise reject the app's custom
	// jodoo:// scheme as unsafe. The value is safe by construction - the key
	// is validated above and the server address is query-escaped.
	deepLink := template.URL("jodoo://join?key=" + key + "&server=" + url.QueryEscape(proto+"://"+r.Host))
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := joinPageTmpl.Execute(w, struct {
		Key      string
		DeepLink template.URL
	}{key, deepLink}); err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
	}
}
