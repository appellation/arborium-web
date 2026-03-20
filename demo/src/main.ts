import { highlight, getAvailableLanguages } from "arborium";
import "arborium/themes/base.css";
import "arborium/themes/one-dark.css";

const sampleJson = JSON.stringify(
  {
    name: "unplugin-arborium",
    version: "0.1.0",
    description:
      "Build-time WASM asset resolution for arborium syntax highlighting",
    languages: ["json"],
    features: {
      buildTimeResolution: true,
      lazyGrammarLoading: true,
      bundlerAgnostic: true,
    },
    numbers: [1, 2, 3, null, true, false],
  },
  null,
  2,
);

const status = document.getElementById("status")!;
const output = document.getElementById("output")!;

status.textContent = `Available languages: ${getAvailableLanguages().join(", ")}`;

highlight("json", sampleJson).then((html) => {
  output.innerHTML = html;
});
