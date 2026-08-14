const fs = require('fs');
const file = 'server.js';
if (fs.existsSync(file)) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(/MXy52Z5zWDFB/g, 'process.env.EMAIL_PASS');
  content = content.replace(/baldeosaheb@zohomail\.in/g, 'process.env.EMAIL_USER');
  fs.writeFileSync(file, content);
  console.log('Cleaned server.js');
}
</content>
<parameter name="line_count">10