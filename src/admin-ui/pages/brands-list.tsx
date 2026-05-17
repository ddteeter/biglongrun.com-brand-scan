import { Elysia, type AnyElysia } from "elysia";
import type { DB } from "../../infrastructure/db";
import { brands } from "../../infrastructure/db/schema";
import { Layout, renderHtml } from "../layout";
import { TextInput } from "../components/form";

export function brandsListRoute(args: { db: DB }): AnyElysia {
  return new Elysia().get("/admin/brands", async () => {
    const rows = await args.db.select().from(brands).orderBy(brands.name);
    return renderHtml(
      <Layout title="Brands" currentPath="/admin/brands">
        <h1>Brands</h1>
        <details>
          <summary role="button">Add brand</summary>
          <form method="post" action="/admin/brands/create">
            <TextInput name="name" label="Name" required autofocus />
            <TextInput name="primaryUrl" label="Primary URL" type="url" required />
            <button type="submit">Create brand</button>
          </form>
        </details>
        <table role="grid">
          <thead>
            <tr>
              <th>Slug</th>
              <th>Name</th>
              <th>Category</th>
              <th>Updated</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr>
                <td>{b.slug}</td>
                <td>
                  <a href={`/admin/brands/${b.slug}`}>{b.name}</a>
                </td>
                <td>{b.categoryTag}</td>
                <td>{b.updatedAt}</td>
                <td>{b.active ? "active" : "inactive"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Layout>
    );
  });
}
