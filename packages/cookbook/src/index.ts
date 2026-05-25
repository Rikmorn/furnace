import { demos } from "./shared/demos-manifest.ts";

const items = [...demos].sort((a, b) => {
  const oa = a.help.order ?? Number.POSITIVE_INFINITY;
  const ob = b.help.order ?? Number.POSITIVE_INFINITY;
  return oa - ob || a.slug.localeCompare(b.slug);
});

const list = document.querySelector<HTMLElement>("#list");
if (!list) throw new Error("[furnace/cookbook] #list element not found");

for (const { slug, help } of items) {
  const a = document.createElement("a");
  a.href = `/${slug}`;
  a.className = "card";

  const titleEl = document.createElement("div");
  titleEl.className = "title";
  titleEl.textContent = slug;

  const blurbEl = document.createElement("div");
  blurbEl.className = "blurb";
  blurbEl.textContent = help.blurb;

  const featuresEl = document.createElement("div");
  featuresEl.className = "features";
  for (const feat of help.features) {
    const pill = document.createElement("span");
    pill.className = "feature";
    pill.textContent = feat;
    featuresEl.appendChild(pill);
  }

  a.appendChild(titleEl);
  a.appendChild(blurbEl);
  a.appendChild(featuresEl);
  list.appendChild(a);
}

if (items.length === 0) {
  const empty = document.createElement("p");
  empty.textContent = "no demos yet.";
  empty.style.color = "var(--text-muted)";
  list.appendChild(empty);
}
