import { registerHooks } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
registerHooks({
  load(url, context, next) {
    if (url.startsWith(pathToFileURL(path.join(root, 'src')).href) && /\.tsx?$/u.test(url)) {
      return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8'), {
        compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},fileName:url,
      }).outputText};
    }
    return next(url,context);
  },
  resolve(specifier, context, next) {
    if (specifier.startsWith('@/')) {
      const base=path.join(root,'src',specifier.slice(2));
      const file=[base,...['.ts','.tsx','.mjs','/index.ts','/index.tsx'].map(suffix=>base+suffix)].find(p=>existsSync(p));
      if(file)return next(pathToFileURL(file).href,context);
    }
    try {return next(specifier,context);} catch(error) {
      if(error.code!=='ERR_MODULE_NOT_FOUND'||!specifier.startsWith('.'))throw error;
      const base=fileURLToPath(new URL(specifier,context.parentURL));
      const file=['.ts','.tsx','.mjs','/index.ts','/index.tsx'].map(suffix=>base+suffix).find(p=>existsSync(p));
      if(!file)throw error;
      return next(pathToFileURL(file).href,context);
    }
  },
});
