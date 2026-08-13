import "./styles.css";

const root = document.createElement("section");
root.className = "omnidraw-widget";

const message = document.createElement("p");
message.textContent = "Widget under construction";

const output = document.createElement("output");
let count = 0;
const render = () => {
  output.textContent = `Local count: ${count}`;
};

const button = document.createElement("button");
button.type = "button";
button.textContent = "Increment";
button.addEventListener("click", () => {
  count += 1;
  render();
});

root.append(message, output, button);
document.body.append(root);
render();
