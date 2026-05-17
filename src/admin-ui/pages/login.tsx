export function LoginPage(props: Readonly<{ error?: string }>): string {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>brand-scan — Login</title>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css"
        />
      </head>
      <body>
        <main class="container" style="max-width: 30em; margin-top: 5em;">
          <hgroup>
            <h1>brand-scan</h1>
            <p>Admin login</p>
          </hgroup>
          {props.error ? (
            <article style="color: var(--pico-color-red-500);">{props.error}</article>
          ) : (
            ""
          )}
          <form method="post" action="/admin/login/submit">
            <label for="password">Password</label>
            <input type="password" name="password" id="password" required autofocus />
            <button type="submit">Sign in</button>
          </form>
        </main>
      </body>
    </html>
  ) as string;
}
