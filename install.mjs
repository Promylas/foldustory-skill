import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageRoot=path.dirname(fileURLToPath(import.meta.url));
const skillName='foldustory';
const serverNames={space:'foldustory'};
export const PROXY_ENV_VARS = Object.freeze(['HTTP_PROXY','HTTPS_PROXY','NO_PROXY','http_proxy','https_proxy','no_proxy']);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const exists=async filename=>{try{await fs.lstat(filename);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
const readOptional=async filename=>{try{return await fs.readFile(filename);}catch(error){if(error.code==='ENOENT')return null;throw error;}};
function sameBytes(a,b){return a===null?b===null:b!==null&&a.equals(b);}
function inside(root,target){return target!==root&&target.startsWith(root+path.sep);}

export async function verifyPackage(root=packageRoot) {
  const manifest=JSON.parse(await fs.readFile(path.join(root,'manifest.json'),'utf8'));
  if(manifest.formatVersion!==1||manifest.name!==skillName||typeof manifest.version!=='string'||!Array.isArray(manifest.files)||!manifest.files.length)throw Error('Invalid package manifest.');
  const known=new Set(['manifest.json']);
  for(const entry of manifest.files){
    if(typeof entry.path!=='string'||entry.path.includes('\\')||entry.path.startsWith('/')||entry.path.split('/').some(x=>!x||x==='.'||x==='..')||known.has(entry.path)||!Number.isSafeInteger(entry.bytes)||!/^[a-f0-9]{64}$/.test(entry.sha256))throw Error('Invalid package file entry.');
    known.add(entry.path);
    const filename=path.resolve(root,entry.path);
    if(!inside(path.resolve(root),filename))throw Error('Package path escaped its root.');
    let current=path.resolve(root);
    for(const segment of entry.path.split('/')){current=path.join(current,segment);if((await fs.lstat(current)).isSymbolicLink())throw Error('Package links are not supported.');}
    const data=await fs.readFile(filename);
    if(data.length!==entry.bytes||sha(data)!==entry.sha256)throw Error('Package integrity check failed: '+entry.path);
  }
  async function inspect(directory,relative=''){
    for(const entry of await fs.readdir(directory,{withFileTypes:true})){
      const name=relative+entry.name;
      if (!relative && entry.name === '.git' && (entry.isDirectory() || entry.isFile())) continue;
      if(entry.isSymbolicLink())throw Error('Package links are not supported.');
      if(entry.isDirectory())await inspect(path.join(directory,entry.name),name+'/');
      else if(!entry.isFile()||!known.has(name))throw Error('Unexpected package file: '+name);
    }
  }
  await inspect(root);
  for(const required of ['install.mjs','skills/foldustory/SKILL.md','skills/foldustory/scripts/launch.mjs','skills/foldustory/scripts/client.mjs','skills/foldustory/scripts/stdio.mjs'])if(!known.has(required))throw Error('Incomplete package: '+required);


  return manifest;
}

export function parseArguments(argv) {
  const options={dryRun:false};
  for(let i=0;i<argv.length;i++){
    const option=argv[i];
    if(option==='--dry-run'){if(options.dryRun)throw Error('Duplicate --dry-run.');options.dryRun=true;continue;}
    if(!['--codex-home','--codex'].includes(option)||!argv[i+1]||argv[i+1].startsWith('--'))throw Error('Usage: node install.mjs [--codex-home DIRECTORY] [--codex EXECUTABLE] [--dry-run]');
    const key=option==='--codex-home'?'codexHome':'codex';if(options[key])throw Error('Duplicate '+option);options[key]=argv[++i];
  }
  return options;
}
export async function resolveCodex(command='codex') {
  const candidates=path.isAbsolute(command)||/[\\/]/.test(command)?[path.resolve(command)]:
    (process.env.PATH??'').split(path.delimiter).filter(Boolean).flatMap(folder=>process.platform==='win32'&&!path.extname(command)?[path.join(folder,command+'.exe'),path.join(folder,command+'.cmd'),path.join(folder,command)]:[path.join(folder,command)]);
  let npmWrapperFound=false;
  for(const candidate of candidates){
    try{
      if(!(await fs.stat(candidate)).isFile())continue;
      if(/\.(cmd|bat)$/i.test(candidate)){
        if(path.basename(candidate).toLowerCase()!=='codex.cmd')continue;
        npmWrapperFound=true;
        const packageDirectory=path.join(path.dirname(candidate),'node_modules','@openai','codex'),entry=path.join(packageDirectory,'bin','codex.js');
        let metadata;try{metadata=JSON.parse(await fs.readFile(path.join(packageDirectory,'package.json'),'utf8'));}catch{continue;}
        if(metadata.name!=='@openai/codex'||metadata.bin?.codex!=='bin/codex.js'||!(await fs.stat(entry)).isFile())continue;
        return {command:process.execPath,prefixArgs:[entry],source:candidate};
      }
      if(process.platform==='win32'){
        const handle=await fs.open(candidate,'r');
        try{const signature=Buffer.alloc(2);await handle.read(signature,0,2,0);if(signature.toString('ascii')!=='MZ')continue;}finally{await handle.close();}
      }
      return {command:candidate,prefixArgs:[],source:candidate};
    }catch(error){if(!['ENOENT','ENOTDIR'].includes(error.code))throw error;}
  }
  throw Error(npmWrapperFound?'Found codex.cmd but not the standard node_modules/@openai/codex/bin/codex.js package beside it. Reinstall the official @openai/codex npm package, or pass --codex with the native Codex executable path. The wrapper was not executed.':'Codex executable not found. Install the Codex CLI or pass --codex with its native executable or standard npm codex.cmd path.');
}
export function codexRun(executable,args,home){
  return new Promise((resolve,reject)=>{
    const child=spawn(executable.command,[...executable.prefixArgs,...args],{cwd:home,env:{...process.env,CODEX_HOME:home},shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let stdout='',size=0,settled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value);};
    const timer=setTimeout(()=>{child.kill();finish(Error('Codex configuration command timed out; live configuration has not been changed.'));},30000);
    child.stdout.on('data',chunk=>{size+=chunk.length;if(size>1024*1024){child.kill();finish(Error('Unexpected Codex output size.'));}else stdout+=chunk;});
    child.stderr.resume();
    child.on('error',()=>finish(Error('Could not start the Codex executable.')));
    child.on('exit',code=>finish(code===0?null:Error('Codex '+args.slice(0,2).join(' ')+' failed (exit '+code+'); no CLI output containing unrelated settings was retained.'),stdout));
  });
}
async function removeOwnedDirectory(root,target){
  const resolvedRoot=path.resolve(root),resolvedTarget=path.resolve(target);
  if(!inside(resolvedRoot,resolvedTarget)||!(path.basename(resolvedTarget).startsWith('foldustory-install-')||path.basename(resolvedTarget).startsWith('.foldustory-stage-')))throw Error('Refusing unexpected cleanup path.');
  const info=await fs.lstat(resolvedTarget);
  if(info.isSymbolicLink()||!info.isDirectory())throw Error('Refusing linked cleanup path.');
  await fs.rm(resolvedTarget,{recursive:true,force:false});
}

export function assertExistingMcpUnchanged(previous,configured){
  for(const server of previous)if(!isDeepStrictEqual(configured.find(value=>value.name===server.name),server))throw Error('Codex changed an unrelated MCP configuration; installation stopped.');
}

/** Change only this fixed MCP table. Persist names, never proxy values. */
export function forwardProxyEnvVars(text, previousNames = []) {
  if (!Array.isArray(previousNames) || previousNames.some(name => typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))) throw Error('Unsupported existing forwarded environment names.');
  const names = [...new Set([...previousNames, ...PROXY_ENV_VARS])];
  const headers = [...text.matchAll(/^\[mcp_servers\.(?:foldustory|"foldustory"|'foldustory')\][ \t]*(?:#[^\r\n]*)?\r?$/gm)];
  if (headers.length !== 1) throw Error('Expected one fixed personal-space MCP table.');
  const header = headers[0], start = header.index + header[0].replace(/\r$/, '').length;
  const rest = text.slice(start), next = rest.search(/^\[/m), end = next < 0 ? text.length : start + next;
  const body = text.slice(start, end), matches = [...body.matchAll(/^[ \t]*env_vars[ \t]*=/gm)];
  if (matches.length > 1) throw Error('Duplicate forwarded environment field.');
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const replacement = 'env_vars = ' + JSON.stringify(names);
  if (!matches.length) return { text: text.slice(0, start) + newline + replacement + text.slice(start), names };
  const assignment = start + matches[0].index;
  let cursor = assignment + matches[0][0].length;
  while (/\s/.test(text[cursor] ?? '') && cursor < end) cursor++;
  if (text[cursor] !== '[') throw Error('Forwarded environment must be an array.');
  let quote = null, escaped = false, comment = false, closing = -1;
  for (cursor++; cursor < end; cursor++) {
    const character = text[cursor];
    if (comment) { if (character === '\n') comment = false; continue; }
    if (quote) { if (escaped) { escaped = false; continue; } if (quote === '"' && character === '\\') escaped = true; else if (character === quote) quote = null; continue; }
    if (character === '"' || character === "'") quote = character;
    else if (character === '#') comment = true;
    else if (character === ']') { closing = cursor + 1; break; }
  }
  if (closing < 0) throw Error('Unterminated forwarded environment array.');
  return { text: text.slice(0, assignment) + replacement + text.slice(closing), names };
}

export function assertProxyForwarding(configured, expectedNames = PROXY_ENV_VARS) {
  const target = configured.find(value => value.name === 'foldustory');
  if (!target || !Array.isArray(target.transport?.env_vars) || target.transport.env_vars.length !== expectedNames.length || expectedNames.some(name => !target.transport.env_vars.includes(name))) throw Error('Codex did not retain the requested proxy environment names.');
}

export async function install({root=packageRoot,codexHome=process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),codex='codex',dryRun=false}={}){
  if(Number(process.versions.node.split('.')[0])<22)throw Error('Node.js 22 or later is required.');
  const manifest=await verifyPackage(root),executable=await resolveCodex(codex),home=path.resolve(codexHome);
  const target=path.join(home,'skills',skillName),configPath=path.join(home,'config.toml'),original=await readOptional(configPath);
  if(await exists(target))throw Error('Skill destination already exists; no files were overwritten: '+target);
  if(await exists(configPath)&&(await fs.lstat(configPath)).isSymbolicLink())throw Error('Symlinked Codex configuration requires manual installation.');
  const stage=await fs.mkdtemp(path.join(os.tmpdir(),'foldustory-install-'));
  let lock,lockPath,skillStage,configStage,installed=false;
  try{
    if(original!==null)await fs.writeFile(path.join(stage,'config.toml'),original,{mode:0o600});
    const previous=JSON.parse(await codexRun(executable,['mcp','list','--json'],stage));
    if(!Array.isArray(previous))throw Error('Unsupported Codex MCP list response.');
    for(const server of Object.values(serverNames))if(previous.some(value=>value.name===server))throw Error('MCP server already exists; no configuration was changed: '+server);
    const launchPath=path.join(target,'scripts/launch.mjs');
    const servers=Object.entries(serverNames).map(([surface,name])=>({name,command:process.execPath,args:[launchPath]}));
    for(const server of servers)await codexRun(executable,['mcp','add',server.name,'--',server.command,...server.args],stage);
    const stagedConfig=path.join(stage,'config.toml');
    const forwarded=forwardProxyEnvVars(await fs.readFile(stagedConfig,'utf8'));
    await fs.writeFile(stagedConfig,forwarded.text,{mode:0o600});
    const configured=JSON.parse(await codexRun(executable,['mcp','list','--json'],stage));
    for(const server of servers)if(!configured.some(value=>value.name===server.name))throw Error('Codex did not register the requested test server.');
    assertExistingMcpUnchanged(previous,configured);
    assertProxyForwarding(configured,forwarded.names);
    const proposed=await fs.readFile(path.join(stage,'config.toml'));
    const summary={version:manifest.version,skillDirectory:target,codexHome:home,codexExecutable:executable.command,codexPrefixArgs:executable.prefixArgs,servers,forwardedEnvironmentVariables:forwarded.names,packageFileCount:manifest.files.length,dryRun};
    if(dryRun)return {...summary,status:'ready',configurationChanged:false};
    await fs.mkdir(home,{recursive:true});
    lockPath=path.join(home,'.foldustory.install.lock');lock=await fs.open(lockPath,'wx',0o600);
    await lock.writeFile(JSON.stringify({pid:process.pid,at:new Date().toISOString()}));
    if(!sameBytes(original,await readOptional(configPath)))throw Error('Codex configuration changed during installation; stop and rerun after reviewing it.');
    if(await exists(target))throw Error('Skill destination appeared during installation; nothing was overwritten.');
    await fs.mkdir(path.dirname(target),{recursive:true});
    skillStage=path.join(path.dirname(target),'.foldustory-stage-'+randomUUID());await fs.mkdir(skillStage);
    const prefix='skills/'+skillName+'/';
    const skillFiles=manifest.files.filter(entry=>entry.path.startsWith(prefix));
    for(const entry of skillFiles){const relative=entry.path.slice(prefix.length),destination=path.join(skillStage,relative);await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination,await fs.readFile(path.join(root,entry.path)),{flag:'wx',mode:0o600});}
    const receipt={formatVersion:1,name:skillName,version:manifest.version,installedAt:new Date().toISOString(),files:skillFiles.map(entry=>({...entry,path:entry.path.slice(prefix.length)})),servers,configBeforeSha256:original===null?null:sha(original),configAfterSha256:sha(proposed)};
    await fs.writeFile(path.join(skillStage,'install-receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
    let backup=null;
    if(original!==null){backup=path.join(home,'config.foldustory-backup-'+randomUUID()+'.toml');await fs.writeFile(backup,original,{flag:'wx',mode:0o600});}
    configStage=path.join(home,'.foldustory-config-'+randomUUID()+'.toml');await fs.writeFile(configStage,proposed,{flag:'wx',mode:0o600});
    if(!sameBytes(original,await readOptional(configPath)))throw Error('Codex configuration changed before commit; original is untouched.');
    await fs.rename(skillStage,target);skillStage=undefined;installed=true;
    if(!sameBytes(original,await readOptional(configPath)))throw Error('Codex configuration changed during commit. Skill files were installed, but MCP configuration was not committed; inspect before retrying.');
    await fs.rename(configStage,configPath);configStage=undefined;
    return {...summary,status:'installed',configurationChanged:true,backup,receipt:path.join(target,'install-receipt.json'),next:'The Skill will be available on the next turn. Restart Codex or its MCP servers if the new tools are not yet visible.'};
  }catch(error){
    if(installed)error.message+=' Installed Skill files have been preserved; no existing configuration was blindly restored.';
    throw error;
  }finally{
    if(configStage&&await exists(configStage))await fs.unlink(configStage);
    if(skillStage&&await exists(skillStage))await removeOwnedDirectory(path.dirname(target),skillStage);
    if(lock){await lock.close();await fs.unlink(lockPath);}
    await removeOwnedDirectory(os.tmpdir(),stage);
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  Promise.resolve().then(()=>install(parseArguments(process.argv.slice(2)))).then(result=>process.stdout.write(JSON.stringify(result,null,2)+'\n')).catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
}
