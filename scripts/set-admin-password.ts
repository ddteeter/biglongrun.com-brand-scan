export {};

const password = process.argv[2];
if (!password) {
  console.error("usage: bun run set-admin-password <password>");
  process.exit(1);
}
const hash = await Bun.password.hash(password);
console.log(`ADMIN_PASSWORD_HASH=${hash}`);
