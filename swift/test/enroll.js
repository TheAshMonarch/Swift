const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...";

const res = await fetch('http://localhost:3000/students/me', {
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
});