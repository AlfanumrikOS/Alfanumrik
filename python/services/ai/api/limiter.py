from slowapi import Limiter
from slowapi.util import get_remote_address

# Default limiter using IP address.
# In the future, we could use a custom key_func that extracts student_id from the JWT
# for per-tenant rate limits.
limiter = Limiter(key_func=get_remote_address)
