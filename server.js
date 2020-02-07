// require serverless version
const app = require('./index.js')

// create local server
app.listen(7505, function () {
    console.log('Addon active on port 7505.');
    console.log('http://127.0.0.1:7505/[imdb-user-id]/manifest.json');
});