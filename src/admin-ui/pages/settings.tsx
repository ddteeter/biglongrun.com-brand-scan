import { Layout, renderHtml } from "../layout";
import { Elysia } from "elysia";
import { SCORING_CONFIG_VERSION, WEIGHTS } from "../../domain/scoring/config";

export function settingsRoute(): Elysia {
  return new Elysia().get("/admin/settings", () =>
    renderHtml(
      <Layout title="Settings" currentPath="/admin/settings">
        <h1>Settings</h1>
        <article>
          <header>
            <h3>Scoring config</h3>
          </header>
          <p>
            Version: <code>{SCORING_CONFIG_VERSION}</code>
          </p>
          <table role="grid">
            <thead>
              <tr>
                <th>Dimension</th>
                <th>Weight</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(WEIGHTS).map(([k, v]) => (
                <tr>
                  <td>{k}</td>
                  <td>{v.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>
        <article>
          <header>
            <h3>Password rotation</h3>
          </header>
          <p>
            Run <code>bun run set-admin-password</code> in the deployed container, then update{" "}
            <code>ADMIN_PASSWORD_HASH</code> in Dokploy and redeploy.
          </p>
        </article>
      </Layout>
    )
  );
}
