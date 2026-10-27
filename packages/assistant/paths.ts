import path from 'node:path';
export const assistantRoot=process.env.MATRIX_ROOT||(path.basename(process.cwd())==='web'&&path.basename(path.dirname(process.cwd()))==='apps'?path.resolve(process.cwd(),'../..'):process.cwd());
export const assistantDirectory=path.join(path.resolve(/* turbopackIgnore: true */process.env.MATRIX_DATA_DIR||path.join(assistantRoot,'.data')),'browser-assistant');
