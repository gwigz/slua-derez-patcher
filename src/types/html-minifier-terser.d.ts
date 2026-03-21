declare module "html-minifier-terser" {
  interface Options {
    collapseWhitespace?: boolean;
    removeComments?: boolean;
    minifyCSS?: boolean;
    minifyJS?: boolean;
    keepClosingSlash?: boolean;
  }

  function minify(html: string, options?: Options): Promise<string>;
}
