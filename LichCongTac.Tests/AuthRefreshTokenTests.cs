using System.IdentityModel.Tokens.Jwt;
using System.Reflection;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using FluentAssertions;
using LichCongTac.Api.Controllers;
using LichCongTac.Core.Data.Interfaces;
using LichCongTac.Models;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.IdentityModel.Tokens;
using Xunit;

namespace LichCongTac.Tests
{
    /// <summary>
    /// Kiểm tra luồng silent refresh: SPA gọi POST /api/auth/refresh KHÔNG có body,
    /// JWT (đã hết hạn) lấy từ header Authorization hoặc cookie jwt_cookie.
    /// </summary>
    public class AuthRefreshTokenTests
    {
        private const string RefreshCookieValue = "refresh-token-of-this-device";

        private readonly string _jwtKey = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));

        // ── Test doubles ─────────────────────────────────────────────────────

        /// <summary>Proxy rỗng: ghi lại tên method được gọi, trả về default / Task hoàn tất.</summary>
        public class RecordingProxy : DispatchProxy
        {
            public List<string> Calls { get; } = new();

            protected override object? Invoke(MethodInfo? targetMethod, object?[]? args)
            {
                Calls.Add(targetMethod!.Name);
                var returnType = targetMethod.ReturnType;

                if (returnType == typeof(Task)) return Task.CompletedTask;

                if (returnType.IsGenericType && returnType.GetGenericTypeDefinition() == typeof(Task<>))
                {
                    var inner = returnType.GetGenericArguments()[0];
                    var value = inner.IsValueType ? Activator.CreateInstance(inner) : null;
                    return typeof(Task).GetMethod(nameof(Task.FromResult))!
                        .MakeGenericMethod(inner)
                        .Invoke(null, new[] { value });
                }

                return returnType != typeof(void) && returnType.IsValueType
                    ? Activator.CreateInstance(returnType)
                    : null;
            }
        }

        private sealed class FakeUserManager : UserManager<User>
        {
            private readonly User _user;

            public FakeUserManager(User user)
                : base(DispatchProxy.Create<IUserStore<User>, RecordingProxy>(),
                       null!, null!, null!, null!, null!, null!, null!, null!)
            {
                _user = user;
            }

            public override Task<User?> FindByNameAsync(string userName)
                => Task.FromResult<User?>(string.Equals(userName, _user.Username, StringComparison.Ordinal) ? _user : null);
        }

        private sealed record Fixture(AuthController Controller, RecordingProxy RepoCalls, User User);

        private Fixture CreateFixture(
            string? bearerToken,
            string? jwtCookie,
            string? refreshCookie,
            string? userRefreshToken = RefreshCookieValue,
            string userStamp = "stamp-current")
        {
            var user = new User
            {
                Id = 7,
                Username = "admin",
                Role = "Admin",
                SecurityStamp = userStamp,
                RefreshToken = userRefreshToken,
                RefreshTokenExpiryTime = DateTime.UtcNow.AddDays(1),
            };

            var repo = DispatchProxy.Create<IUserRepository, RecordingProxy>();
            var config = new ConfigurationBuilder()
                .AddInMemoryCollection(new Dictionary<string, string?> { ["JWT_SECRET"] = _jwtKey })
                .Build();

            var http = new DefaultHttpContext();
            if (bearerToken != null) http.Request.Headers.Authorization = $"Bearer {bearerToken}";

            var cookies = new List<string>();
            if (jwtCookie != null) cookies.Add($"jwt_cookie={jwtCookie}");
            if (refreshCookie != null) cookies.Add($"refresh_cookie={refreshCookie}");
            if (cookies.Count > 0) http.Request.Headers.Cookie = string.Join("; ", cookies);

            var controller = new AuthController(config, repo, new FakeUserManager(user), null!)
            {
                ControllerContext = new ControllerContext { HttpContext = http },
            };

            return new Fixture(controller, (RecordingProxy)(object)repo, user);
        }

        private string CreateExpiredJwt(string stamp)
        {
            var descriptor = new SecurityTokenDescriptor
            {
                Subject = new ClaimsIdentity(new[]
                {
                    new Claim(ClaimTypes.Name, "admin"),
                    new Claim(ClaimTypes.Role, "Admin"),
                    new Claim(ClaimTypes.NameIdentifier, "7"),
                    new Claim("uid", "7"),
                    new Claim("sec_stamp", stamp),
                }),
                NotBefore = DateTime.UtcNow.AddHours(-48),
                Expires = DateTime.UtcNow.AddHours(-24),
                SigningCredentials = new SigningCredentials(
                    new SymmetricSecurityKey(Encoding.ASCII.GetBytes(_jwtKey)),
                    SecurityAlgorithms.HmacSha256),
            };

            var handler = new JwtSecurityTokenHandler();
            return handler.WriteToken(handler.CreateToken(descriptor));
        }

        // ── Tests ────────────────────────────────────────────────────────────

        [Fact]
        public async Task Refresh_WithoutAnyCredentials_Returns401()
        {
            var f = CreateFixture(bearerToken: null, jwtCookie: null, refreshCookie: null);

            var result = await f.Controller.RefreshToken();

            result.Should().BeOfType<UnauthorizedObjectResult>();
            f.RepoCalls.Calls.Should().NotContain("UpdateRefreshTokenAsync");
        }

        [Fact]
        public async Task Refresh_ExpiredJwtInHeader_WithValidRefreshCookie_IssuesNewToken()
        {
            var expired = CreateExpiredJwt("stamp-current");
            var f = CreateFixture(bearerToken: expired, jwtCookie: null, refreshCookie: RefreshCookieValue);

            var result = await f.Controller.RefreshToken();

            var ok = result.Should().BeOfType<OkObjectResult>().Subject;
            using var json = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
            json.RootElement.GetProperty("Success").GetBoolean().Should().BeTrue();

            var newToken = json.RootElement.GetProperty("Data").GetProperty("token").GetString();
            newToken.Should().NotBeNullOrWhiteSpace();
            newToken.Should().NotBe(expired);

            var parsed = new JwtSecurityTokenHandler().ReadJwtToken(newToken);
            parsed.ValidTo.Should().BeAfter(DateTime.UtcNow);
            parsed.Claims.First(c => c.Type == "sec_stamp").Value.Should().Be("stamp-current");

            f.RepoCalls.Calls.Should().Contain("UpdateRefreshTokenAsync");
        }

        [Fact]
        public async Task Refresh_ExpiredJwtOnlyInHttpOnlyCookie_IssuesNewToken()
        {
            var expired = CreateExpiredJwt("stamp-current");
            var f = CreateFixture(bearerToken: null, jwtCookie: expired, refreshCookie: RefreshCookieValue);

            var result = await f.Controller.RefreshToken();

            result.Should().BeOfType<OkObjectResult>();
        }

        [Fact]
        public async Task Refresh_RefreshCookieOfAnotherDevice_Returns401()
        {
            var f = CreateFixture(
                bearerToken: CreateExpiredJwt("stamp-current"),
                jwtCookie: null,
                refreshCookie: "stale-refresh-token",
                userRefreshToken: "token-issued-to-newer-login");

            var result = await f.Controller.RefreshToken();

            result.Should().BeOfType<UnauthorizedObjectResult>();
            f.RepoCalls.Calls.Should().NotContain("UpdateRefreshTokenAsync");
        }

        [Fact]
        public async Task Refresh_TokenWithRotatedSecurityStamp_Returns401()
        {
            var f = CreateFixture(
                bearerToken: CreateExpiredJwt("stamp-before-other-login"),
                jwtCookie: null,
                refreshCookie: RefreshCookieValue,
                userStamp: "stamp-after-other-login");

            var result = await f.Controller.RefreshToken();

            result.Should().BeOfType<UnauthorizedObjectResult>();
            f.RepoCalls.Calls.Should().NotContain("UpdateRefreshTokenAsync");
        }

        [Fact]
        public void RefreshEndpoint_MustNotRequireRequestBody()
        {
            // Regression: endpoint từng bắt buộc [FromBody] nên SPA gọi POST rỗng nhận 415 → luôn mất phiên.
            var method = typeof(AuthController).GetMethod(nameof(AuthController.RefreshToken));

            method.Should().NotBeNull();
            method!.GetParameters().Should().BeEmpty();
        }
    }
}
