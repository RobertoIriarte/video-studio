const [command = 'comando', task = 'tarea posterior'] = process.argv.slice(2);

console.error(`${command}: pendiente de ${task}. F1-01 solo prepara el monorepo; no inicia servicios ni modifica datos.`);
process.exitCode = 1;
