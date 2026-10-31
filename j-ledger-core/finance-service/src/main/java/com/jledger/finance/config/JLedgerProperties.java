package com.jledger.finance.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

import java.math.BigDecimal;
import java.util.UUID;

@Configuration
@ConfigurationProperties(prefix = "jledger")
@Getter
@Setter
public class JLedgerProperties {

    private final Limits limits = new Limits();
    private final System system = new System();

    @Getter
    @Setter
    public static class Limits {
        private BigDecimal daily = new BigDecimal("1000000");
        private BigDecimal perTransaction = new BigDecimal("500000");
        private BigDecimal monthly = new BigDecimal("5000000");
    }

    @Getter
    @Setter
    public static class System {
        private UUID accountId = UUID.fromString("00000000-0000-0000-0000-000000000000");
        private UUID feeAccountId = UUID.fromString("00000000-0000-0000-0000-000000000001");
        private UUID roundingDifferenceAccountId = UUID.fromString("00000000-0000-0000-0000-000000000002");
    }
}
