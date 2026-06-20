// test-api.js
const API_BASE = 'http://localhost:3000';
const sid = "69fd236d2fc2344693371b96";
async function testLogin() {
    try {
        const loginData = {
            email: "rhemaamasi12@gmail.com",
            password: "Rhemarex12@."
        };

        console.log('Sending login request...');

        const loginRes = await fetch(`${API_BASE}/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(loginData)
        });

        const loginResult = await loginRes.json();
        console.log('Login Response:', loginResult);

        if (loginRes.ok) {
            const token = loginResult.access_token;
            console.log('Access Token received');

            // Now test a protected route
        }
        return loginResult.access_token;

    } catch (error) {
        console.error('Error:', error.message);
    }
}

async function testProtectedRoute(token) {
    console.log('\nTesting protected route...');

    const res = await fetch(`${API_BASE}/students/me`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });

    const data = await res.json();
    console.log('Protected Route Response:', data);
}

async function enrollStudent(studentId, courseId, accessT) {
    if (!accessT) {
        console.log('No token. Logging in first...');
        await login();
    }

    try {
        console.log(` Enrolling student ${studentId} in course ${courseId}...`);

        const res = await fetch(`${API_BASE}/students/${studentId}/enroll/${courseId}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessT}`,
                'Content-Type': 'application/json'
            }
        });

        const data = await res.json();

        if (res.ok) {
            console.log('Enrollment Successful!');
            console.log('Updated Student:', data);
        } else {
            console.error(' Enrollment Failed:', data);
        }

        return data;
    } catch (err) {
        console.error(' Request Error:', err.message);
    }
}

async function getEnrolledClasses(access_token){
    try{
        console.log("fetching data for student ")
        const res = await fetch(`${API_BASE}/students/me/classes/`, {
            headers: {
                'Authorization': `Bearer ${access_token}`,
                'Content-Type': 'application/json'
            }
        });
        const data = await res.json();
        if(res.ok) console.log(`retrieved successfull here is the recieved data` , data);
    }catch(error){
        console.error(error.message);
    }
}
const at = await testLogin();
getEnrolledClasses(at);