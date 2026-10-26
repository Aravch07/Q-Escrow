/* solc-js only. Once npm dependencies are installed, compilation is offline. */
const fs = require('node:fs');
const path = require('node:path');
const solc = require('solc');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'contracts/PQEscrow.sol'), 'utf8');
const input = {language:'Solidity', sources:{'PQEscrow.sol':{content:source}}, settings:{
  optimizer:{enabled:true,runs:200}, viaIR:true, evmVersion:'paris',
  outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}
}};
const output = JSON.parse(solc.compile(JSON.stringify(input)));
for (const error of output.errors || []) process.stderr.write(error.formattedMessage + '\n');
if ((output.errors || []).some(x => x.severity === 'error')) process.exit(1);
const c = output.contracts['PQEscrow.sol'].PQEscrow;
fs.mkdirSync(path.join(root,'build'),{recursive:true});
fs.writeFileSync(path.join(root,'build/PQEscrow.json'), JSON.stringify({
  contractName:'PQEscrow', compiler:solc.version(), evmVersion:'paris', abi:c.abi,
  bytecode:'0x'+c.evm.bytecode.object, deployedBytecode:'0x'+c.evm.deployedBytecode.object
}, null, 2));
console.log('Compiled build/PQEscrow.json with '+solc.version());
