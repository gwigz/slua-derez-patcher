/// <reference types="typed-htmx" />

declare function h(
  tag: string | ((props: Record<string, unknown>) => string),
  props: Record<string, unknown> | null,
  ...children: unknown[]
): string;
declare function Fragment(props: { children?: unknown }): string;

interface AlpineAttributes {
  "x-data"?: string;
  "x-init"?: string;
  "x-show"?: string;
  "x-text"?: string;
  "x-html"?: string;
  "x-model"?: string;
  "x-effect"?: string;
  "x-ref"?: string;
  "x-if"?: string;
  "x-for"?: string;
  "x-teleport"?: string;
  "x-cloak"?: boolean;
  "x-ignore"?: boolean;
  "x-transition"?: string;
  [key: `x-bind:${string}`]: string;
  [key: `x-on:${string}`]: string;
  [key: `x-transition:${string}`]: string;
}

type HtmlAttributes = HtmxAttributes &
  AlpineAttributes & {
    [key: string]: string | number | boolean | null | undefined;
  };

declare namespace JSX {
  type Element = string;
  interface IntrinsicElements {
    [tag: string]: HtmlAttributes;
  }
}
