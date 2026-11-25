export default ({ g, check }) => {
  const scope = g('depotScope');
  check('format: scope all when no filter', scope(null, 2) === 'alle Depots');
  check('format: scope all when all selected', scope(['a', 'b'], 2) === 'alle Depots');
  check('format: scope partial', scope(['a'], 2) === '1 von 2 Depots');
  check('format: single depot file', scope(['a'], 1) === 'alle Depots');
};
