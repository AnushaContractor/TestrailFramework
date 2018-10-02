module.exports = ( environment ) => {
  return require('./' + environment + '.json');
};