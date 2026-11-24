#!/usr/bin/env node
/**
 * scripts/generate-menu-catalog.js
 *
 * Builds netlify/functions/lib/menu-catalog.json (the SERVER-SIDE price list) from index.html,
 * so that create-checkout.js can reject manipulated prices.
 *
 * Run this after EVERY change to menu items, prices or add-ons in index.html:
 *     node scripts/generate-menu-catalog.js
 * and commit the updated menu-catalog.json together with index.html.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function extract(re, label) {
  const m = html.match(re);
  if (!m) throw new Error(`Could not find ${label} in index.html`);
  return m[0];
}

const menuSrc = extract(/const MENU_DATA = \{[\s\S]*?\n    \};/, 'MENU_DATA');
const pizzaSrc = extract(/const PIZZA_ADDONS = \[[\s\S]*?\];/, 'PIZZA_ADDONS');
const burgerSrc = extract(/const BURGER_ADDONS = \[[\s\S]*?\];/, 'BURGER_ADDONS');
const saladSrc = extract(/const SALAD_ADDONS = \[[\s\S]*?\];/, 'SALAD_ADDONS');

// The extracted snippets are plain data literals from our own file.
const MENU_DATA = new Function(`${menuSrc}; return MENU_DATA;`)();
const PIZZA_ADDONS = new Function(`${pizzaSrc}; return PIZZA_ADDONS;`)();
const BURGER_ADDONS = new Function(`${burgerSrc}; return BURGER_ADDONS;`)();
const SALAD_ADDONS = new Function(`${saladSrc}; return SALAD_ADDONS;`)();

const TYPE_BY_CATEGORY = { pizzor: 'pizza', special: 'pizza', burgers: 'burger', sallader: 'salad', kebab: 'none', tillbehor: 'none' };
const slim = (a) => a.map((x) => ({ price: x.price, replaceBase: !!x.replaceBase }));

const items = {};
for (const [cat, type] of Object.entries(TYPE_BY_CATEGORY)) {
  for (const it of MENU_DATA[cat] || []) {
    items[it.id] = {
      num: it.num || null,
      name: it.name,
      type,
      prices: it.variants ? it.variants.map((v) => v.price) : [it.price],
      variants: it.variants ? it.variants.map((v) => v.label) : null
    };
  }
}

const out = {
  generatedFrom: 'index.html',
  addons: { pizza: slim(PIZZA_ADDONS), burger: slim(BURGER_ADDONS), salad: slim(SALAD_ADDONS) },
  items
};

const target = path.join(root, 'netlify', 'functions', 'lib', 'menu-catalog.json');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify(out, null, 2) + '\n');
console.log(`menu-catalog.json written: ${Object.keys(items).length} items -> ${path.relative(root, target)}`);
