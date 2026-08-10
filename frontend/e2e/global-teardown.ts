import { stopAnvil } from "./anvil";

export default async function globalTeardown() {
  stopAnvil();
}
