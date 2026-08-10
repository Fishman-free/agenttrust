import { deployContracts, startAnvil } from "./anvil";

export default async function globalSetup() {
  await startAnvil();
  try {
    deployContracts();
  } catch (error) {
    const { stopAnvil } = await import("./anvil");
    stopAnvil();
    throw error;
  }
}
