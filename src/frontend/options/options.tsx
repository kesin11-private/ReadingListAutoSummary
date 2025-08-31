import { render } from "preact";

function App() {
  return (
    <main class="p-4">
      <h1 class="text-xl font-bold">Reading List Auto Summary</h1>
      <p class="mt-2 text-sm text-gray-700">Options page powered by Preact.</p>
    </main>
  );
}

const root = document.getElementById("root");
if (root) {
  render(<App />, root);
}
