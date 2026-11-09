import { formatVersion, renderStart } from "./app";
import "./style.css";

const root = document.querySelector<HTMLElement>("#app");
if (root) {
  renderStart(root, formatVersion(__APP_VERSION__));
}
